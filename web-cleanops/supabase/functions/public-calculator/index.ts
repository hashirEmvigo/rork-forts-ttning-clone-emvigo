// ============================================================================
// CleanOps — PUBLIC PRICE CALCULATOR: config + calculate + submit
// ============================================================================
//
// The ONLY public entry point for the price calculator. The unauthenticated
// calculator page never touches the calculator tables directly (they have NO
// anon RLS policies — see migrations 0058/0059); every public request goes
// through this function, which holds the service_role key (injected by Supabase
// as SUPABASE_SERVICE_ROLE_KEY) and is therefore the single trusted boundary.
//
// Three actions (single POST, action-routed — matching this repo's convention
// of one fat function per concern, e.g. admin-create-user / admin-delete-user):
//
//   1. action="config"     → public-safe calculator config for a public slug.
//        • Slug not found             → 404 { ok:false, error:"not_found" }.
//        • Found but enabled=false    → 200 { ok:true, enabled:false, ... } with
//          ONLY page copy + behaviour flags (services/questions/plans withheld
//          so the calculator's shape never leaks before launch). MVP ships dark
//          (enabled=false), so this disabled-but-found state is expected.
//        • Found and enabled=true     → 200 full public-safe config.
//
//   2. action="calculate"  → server-authoritative price for a service + answers.
//        • Loads settings/service/plans/pricing_rules with the service role,
//          maps them into the APPROVED pure pricing engine input, runs the
//          engine server-side, and returns the figures + display text. NEVER
//          trusts a client-supplied price. Writes NOTHING.
//        • Computes regardless of enabled (so the path is verifiable while the
//          page is dark); the response echoes `enabled`. The response exposes
//          NO pricing-rule values, margins, or internal calculation trace.
//
//   3. action="submit"     → the WRITE path. Recomputes the price server-side,
//        then — ONLY when the calculator is ENABLED and the recompute is valid —
//        performs the ordered writes prospect → quote_request →
//        quote_request_answers (with a frozen pricing snapshot). The CRITICAL
//        SAFETY RULE: when enabled=false the calculator is dark and submit
//        writes NOTHING (returns available:false / status:"not_available").
//        Email is required; the client price is never trusted. The public
//        response carries only the quote LEGACY id (never a uuid), the figures,
//        validity and next-step copy — no rule values or internal trace.
//
// SECURITY: all public inputs are validated/!sanitised in the pure layer
//   (../_shared/calculator/publicCalculator.ts); answer payloads are capped
//   (size/length). ABUSE PROTECTION (Slice 12B): every request is rate-limited
//   per IP (submit strictest), submit additionally has a per-email cap and a
//   honeypot, and a hit on any limit / the honeypot writes NOTHING. Identifiers
//   (IP/email) are HMAC-hashed with the server-only service-role key before they
//   reach the throttle table, so no raw IP/email/PII is ever stored
//   (see ../_shared/calculator/abuseGuard.ts + migration 0064). The throttle
//   counter is the ONLY thing written for a blocked request, and never any
//   business data — the dark calculator still writes no prospect/quote/answer.
//   The service_role key never leaves this function. CORS mirrors the existing
//   admin functions.
//
// Required runtime env (auto-injected by Supabase):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import {
  buildHoneypotSubmitResponse,
  buildPublicConfig,
  isValidSlug,
  normalizeSlug,
  prepareSubmission,
  runCalculation,
  validateCalculateRequest,
  validateSubmitRequest,
  withRoundingFallback,
} from "../_shared/calculator/publicCalculator.ts";
import {
  coerceAddonSelections,
  prepareSubmissionV2Home,
  runCalculationV2Home,
  shouldRouteServiceToV2,
  type CalculatorAddonRowV2,
} from "../_shared/calculator/publicCalculatorV2.ts";
import {
  EMAIL_SUBMIT_CAP,
  extractClientIp,
  isHoneypotFilled,
  rateLimitedResponseBody,
  resolveIpRateLimit,
  throttleKeySource,
  windowBucket,
  type RateLimitPlan,
} from "../_shared/calculator/abuseGuard.ts";
import type {
  CalculatorAddonConfigRow,
  CalculatorQuestionRow,
  CalculatorServiceRow,
  CalculatorSettingsRow,
  CleaningPlanRow,
  CompanyRow,
  ExistingProspect,
  PreparedSubmission,
  PricingRuleRow,
} from "../_shared/calculator/types.ts";

// Bumped on every meaningful change so the deployed build is identifiable in
// logs and responses. If this value is NOT present in the response, the OLD
// function is still deployed.
const FUNCTION_VERSION = "2026-public-calculator-9-generic-config-fields";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Column selection lists — explicit so internal-only columns (pricing internals,
// submission behaviour, thresholds, ids) are never even fetched for config.
const SETTINGS_CONFIG_COLUMNS =
  "id, company_id, company_legacy_id, enabled, public_slug, price_display_mode, " +
  "show_price_before_contact, require_contact_before_result, " +
  "show_login_prompt_after_submit, quote_validity_days, currency, " +
  "rut_display_mode, default_vat_rate_percent, content";
const SETTINGS_CALC_COLUMNS = "id, company_id, currency, price_display_mode, enabled, default_vat_rate_percent";
const SERVICE_COLUMNS =
  "id, service_key, display_name, description, enabled, coming_soon, " +
  "pricing_model, sort_order, settings_json";
const QUESTION_COLUMNS =
  "id, calculator_service_id, question_key, label, help_text, input_type, " +
  "required, options_json, validation_json, sort_order";
const PLAN_COLUMNS =
  "id, calculator_service_id, calculator_service_legacy_id, service_key, plan_key, name, description, " +
  "hourly_rate, vat_rate_percent, price_adjustment_type, price_adjustment_value, rut_eligible, rut_enabled, " +
  "rut_percent, rut_apply_to, show_rut_breakdown, flexibility_level, " +
  "customer_day_time_control, same_staff_preference_level, booking_priority, " +
  "cancellation_terms_summary, is_default, sort_order, " +
  // V2 plan columns (migration 0073, Slice V2-D0). Loaded for the Home V2 calculate
  // branch; ignored by the legacy mapper for other services.
  "start_adjustment_hours, price_per_sqm_excl_vat, fixed_adjustment_excl_vat, minimum_price_excl_vat";
const RULE_COLUMNS = "id, rule_key, rule_type, value_numeric";
// Add-on columns (calculator_addons, migration 0074). Loaded ONLY for the Home V2
// calculate branch; pricing uses active rows (public visibility does not gate math).
const ADDON_COLUMNS =
  "addon_key, name, public_label, description, input_type, boolean_default, " +
  "quantity_min, quantity_max, quantity_step, quantity_default, " +
  "effect_time_minutes, effect_fixed_excl_vat, effect_percent, " +
  "active, public_visible, required, sort_order";
// Config add-on columns (calculator_addons, migration 0074, Slice V2-E3-1) —
// PUBLIC-SAFE ONLY. The pricing effect channels (effect_time_minutes /
// effect_fixed_excl_vat / effect_percent) and the internal admin `name` are
// deliberately NEVER fetched for the config action, so they cannot leak. Rows are
// filtered to active + public_visible + not-deleted in SQL (and re-checked by the
// pure mapper). calculator_service_id is needed to group add-ons under a service.
const ADDON_CONFIG_COLUMNS =
  "calculator_service_id, addon_key, public_label, description, input_type, " +
  "boolean_default, quantity_min, quantity_max, quantity_step, quantity_default, " +
  "required, sort_order";
// Submit needs the FULL settings row (submission-behaviour columns the
// config/calculate selections deliberately never fetch: thresholds, validity,
// default status) plus the answer's affects_pricing flag (frozen onto each
// answer snapshot) and a tiny lookup for the dedup-by-email prospect.
const SETTINGS_SUBMIT_COLUMNS =
  "id, company_id, company_legacy_id, enabled, public_slug, price_display_mode, " +
  "currency, default_vat_rate_percent, quote_validity_days, manual_review_threshold_amount, " +
  "default_quote_status, show_login_prompt_after_submit, content";
const QUESTION_SUBMIT_COLUMNS = QUESTION_COLUMNS + ", affects_pricing";
const PROSPECT_LOOKUP_COLUMNS =
  "id, legacy_id, prospect_status, name, email, phone, postal_code, source_url";

/**
 * Generates a unique, non-uuid business legacy id for a written row (prospect /
 * quote_request / quote_request_answers). Time-ordered prefix + random tail so
 * it is sortable AND collision-safe under the table's `legacy_id` unique index.
 */
function newId(prefix: string): string {
  const rand = crypto.randomUUID().replace(/-/g, "");
  return `${prefix}_${Date.now().toString(36)}${rand.slice(0, 12)}`;
}

/** JSON response helper that always includes CORS headers + the function version. */
function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify({ ...body, functionVersion: FUNCTION_VERSION }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** A 429 rate-limit response: the friendly internals-free body + a Retry-After header. */
function rateLimited(retryAfterSeconds: number): Response {
  const secs = Math.max(0, Math.floor(retryAfterSeconds));
  return new Response(
    JSON.stringify({ ...rateLimitedResponseBody(secs), functionVersion: FUNCTION_VERSION }),
    {
      status: 429,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Retry-After": String(secs),
      },
    },
  );
}

// deno-lint-ignore no-explicit-any
type AdminClient = any;

/**
 * HMAC-SHA256 hex of `message` keyed by `secret` (64 lowercase hex chars). Used
 * to turn a raw identifier (IP / email) into the OPAQUE, irreversible throttle
 * key BEFORE it reaches the DB — so no raw IP or email is ever stored.
 */
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface ThrottleDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Records ONE hit against a (scope + identifier) fixed-window counter via the
 * atomic `record_public_request` RPC and returns whether it is within budget.
 * The identifier is HMAC-hashed (server-only key) before the call, so the DB only
 * ever sees an opaque digest. FAILS OPEN on any throttle error so a counter
 * outage can never take the public calculator down. Writes only the hashed
 * counter — never any business/PII data.
 */
async function enforceRateLimit(
  admin: AdminClient,
  secret: string,
  scope: string,
  identifier: string,
  plan: RateLimitPlan,
  nowMs: number,
): Promise<ThrottleDecision> {
  try {
    const bucket = windowBucket(nowMs, plan.windowSeconds);
    const keyHash = await hmacHex(secret, throttleKeySource({ scope, identifier, bucket }));
    const { data, error } = await admin.rpc("record_public_request", {
      p_key_hash: keyHash,
      p_limit: plan.limit,
      p_window_seconds: plan.windowSeconds,
    });
    if (error) {
      console.error("[public-calculator] throttle rpc failed (failing open).", error);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const allowed = row ? Boolean(row.allowed) : true;
    const retryAfterSeconds =
      row && typeof row.retry_after_seconds === "number"
        ? (row.retry_after_seconds as number)
        : plan.windowSeconds;
    return { allowed, retryAfterSeconds };
  } catch (err) {
    console.error("[public-calculator] throttle check threw (failing open).", err);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Handles action="config": resolve a slug → public-safe calculator config. */
async function handleConfig(admin: AdminClient, body: Record<string, unknown>): Promise<Response> {
  const slug = normalizeSlug(body.slug ?? body.publicSlug);
  if (!isValidSlug(slug)) {
    return json({ ok: false, error: "A valid public slug is required." }, 400);
  }

  const { data: settings, error: settingsError } = await admin
    .from("calculator_settings")
    .select(SETTINGS_CONFIG_COLUMNS)
    .eq("public_slug", slug)
    .is("deleted_at", null)
    .maybeSingle();

  if (settingsError) {
    console.error("[public-calculator] config: settings load failed.", settingsError);
    return json({ ok: false, error: "Could not load the calculator." }, 500);
  }
  if (!settings) {
    return json({ ok: false, error: "not_found" }, 404);
  }
  const settingsRow = settings as CalculatorSettingsRow;
  const enabled = Boolean(settingsRow.enabled);

  // Company name (public-safe). Failure here is non-fatal — config still renders.
  const { data: company } = await admin
    .from("companies")
    .select("id, name, legacy_id")
    .eq("id", settingsRow.company_id)
    .maybeSingle();

  // When disabled (MVP default) the structural parts are withheld by
  // buildPublicConfig, so we skip loading them entirely (no leak, less work).
  let services: CalculatorServiceRow[] = [];
  let questions: CalculatorQuestionRow[] = [];
  let plans: CleaningPlanRow[] = [];
  let addons: CalculatorAddonConfigRow[] = [];

  if (enabled) {
    const { data: serviceRows, error: servicesError } = await admin
      .from("calculator_services")
      .select(SERVICE_COLUMNS)
      .eq("company_id", settingsRow.company_id)
      .is("deleted_at", null)
      .or("enabled.eq.true,coming_soon.eq.true")
      .order("sort_order", { ascending: true });
    if (servicesError) {
      console.error("[public-calculator] config: services load failed.", servicesError);
      return json({ ok: false, error: "Could not load the calculator." }, 500);
    }
    services = (serviceRows as CalculatorServiceRow[] | null) ?? [];

    const enabledServiceIds = services.filter((s) => s.enabled).map((s) => s.id);
    if (enabledServiceIds.length > 0) {
      const { data: questionRows, error: questionsError } = await admin
        .from("calculator_questions")
        .select(QUESTION_COLUMNS)
        .in("calculator_service_id", enabledServiceIds)
        .eq("active", true)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true });
      if (questionsError) {
        console.error("[public-calculator] config: questions load failed.", questionsError);
        return json({ ok: false, error: "Could not load the calculator." }, 500);
      }
      questions = (questionRows as CalculatorQuestionRow[] | null) ?? [];

      // Generic add-ons (Slice V2-E3-1): active + public_visible + not-deleted,
      // scoped to the ENABLED services only, in sort order. Non-fatal on error —
      // the config still renders (services just carry no add-ons). The pure mapper
      // re-checks visibility and never sees pricing internals (not selected above).
      const { data: addonRows, error: addonsError } = await admin
        .from("calculator_addons")
        .select(ADDON_CONFIG_COLUMNS)
        .in("calculator_service_id", enabledServiceIds)
        .eq("active", true)
        .eq("public_visible", true)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true });
      if (addonsError) {
        console.error(
          "[public-calculator] config: add-ons load failed (continuing without).",
          addonsError,
        );
      } else {
        addons = (addonRows as CalculatorAddonConfigRow[] | null) ?? [];
      }
    }

    const { data: planRows, error: plansError } = await admin
      .from("cleaning_plans")
      .select(PLAN_COLUMNS)
      .eq("company_id", settingsRow.company_id)
      .eq("active", true)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });
    if (plansError) {
      console.error("[public-calculator] config: plans load failed.", plansError);
      return json({ ok: false, error: "Could not load the calculator." }, 500);
    }
    plans = (planRows as CleaningPlanRow[] | null) ?? [];
  }

  const result = buildPublicConfig({
    company: (company as CompanyRow | null) ?? null,
    settings: settingsRow,
    services,
    questions,
    plans,
    addons,
  });

  console.log("[public-calculator] config", {
    functionVersion: FUNCTION_VERSION,
    slug,
    enabled,
    services: result.services.length,
    plans: result.cleaningPlans.length,
    addonsLoaded: addons.length,
  });

  return json(result as unknown as Record<string, unknown>, 200);
}

/** Handles action="calculate": server-authoritative price for a service + answers. */
async function handleCalculate(admin: AdminClient, body: Record<string, unknown>): Promise<Response> {
  const slug = normalizeSlug(body.slug ?? body.publicSlug);
  if (!isValidSlug(slug)) {
    return json({ ok: false, error: "A valid public slug is required." }, 400);
  }

  const validation = validateCalculateRequest(body);
  if (!validation.ok) {
    return json({ ok: false, error: validation.error }, 400);
  }
  const request = validation.value;

  const { data: settings, error: settingsError } = await admin
    .from("calculator_settings")
    .select(SETTINGS_CALC_COLUMNS)
    .eq("public_slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (settingsError) {
    console.error("[public-calculator] calculate: settings load failed.", settingsError);
    return json({ ok: false, error: "Could not load the calculator." }, 500);
  }
  if (!settings) {
    return json({ ok: false, error: "not_found" }, 404);
  }
  const settingsRow = settings as CalculatorSettingsRow;

  // Match the requested service within this company (active + not soft-deleted).
  const { data: serviceRow, error: serviceError } = await admin
    .from("calculator_services")
    .select(SERVICE_COLUMNS)
    .eq("company_id", settingsRow.company_id)
    .eq("service_key", request.serviceKey)
    .is("deleted_at", null)
    .maybeSingle();
  if (serviceError) {
    console.error("[public-calculator] calculate: service load failed.", serviceError);
    return json({ ok: false, error: "Could not load the service." }, 500);
  }
  const service = (serviceRow as CalculatorServiceRow | null) ?? null;

  // Company plans (to resolve the selected plan) + this service's pricing rules.
  const { data: planRows, error: plansError } = await admin
    .from("cleaning_plans")
    .select(PLAN_COLUMNS)
    .eq("company_id", settingsRow.company_id)
    .eq("active", true)
    .is("deleted_at", null);
  if (plansError) {
    console.error("[public-calculator] calculate: plans load failed.", plansError);
    return json({ ok: false, error: "Could not load the cleaning plans." }, 500);
  }
  const plans = (planRows as CleaningPlanRow[] | null) ?? [];

  let rules: PricingRuleRow[] = [];
  if (service) {
    const { data: ruleRows, error: rulesError } = await admin
      .from("pricing_rules")
      .select(RULE_COLUMNS)
      .eq("calculator_service_id", service.id)
      .eq("active", true)
      .is("deleted_at", null);
    if (rulesError) {
      console.error("[public-calculator] calculate: rules load failed.", rulesError);
      return json({ ok: false, error: "Could not load the pricing rules." }, 500);
    }
    rules = (ruleRows as PricingRuleRow[] | null) ?? [];
  }

  // ── Calculator V2 calculate branch (Slice V2-E2 + GPM-5b-1) ─────────────────
  // Routes to V2 when the matched service is the Home pilot (V2_ENABLED_SERVICE_KEYS)
  // OR a public/ready LITERAL generic `sqm_fixed` service (shouldRouteServiceToV2).
  // Everything else — office/move-out/deep legacy aliases, draft or unready generic
  // services, hourly_by_area — stays on the legacy engine below and returns a safe
  // invalid response. Loads the generic add-ons for the matched service and prices
  // through the Calculator V2 core (canonical config → shared engine → generic
  // add-on resolver), preserving the existing public response contract. Rounding
  // comes from settings_json.displayRoundingInterval — NOT the legacy fallback below.
  if (
    service &&
    shouldRouteServiceToV2({
      service,
      serviceKey: request.serviceKey,
      plans,
      rules,
      defaults: { currency: settingsRow.currency },
    })
  ) {
    let addons: CalculatorAddonRowV2[] = [];
    const { data: addonRows, error: addonsError } = await admin
      .from("calculator_addons")
      .select(ADDON_COLUMNS)
      .eq("calculator_service_id", service.id)
      .eq("active", true)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });
    if (addonsError) {
      // Non-fatal: price without add-ons rather than failing the whole calculation.
      console.error(
        "[public-calculator] calculate(v2): add-ons load failed (continuing without).",
        addonsError,
      );
    } else {
      addons = (addonRows as CalculatorAddonRowV2[] | null) ?? [];
    }

    // add-on selections live under answers.addonSelections (a nested object), which
    // validateCalculateRequest's flat coercion strips — so read them from the RAW body.
    const v2Result = runCalculationV2Home({
      settings: settingsRow,
      service,
      plans,
      rules,
      addons,
      request,
      addonSelections: coerceAddonSelections(body.answers),
    });

    console.log("[public-calculator] calculate(v2-home)", {
      functionVersion: FUNCTION_VERSION,
      slug,
      serviceKey: request.serviceKey,
      answerKeys: Object.keys(request.answers),
      addonsLoaded: addons.length,
      visitsPerFourWeeks: v2Result.v2?.visitsPerFourWeeks,
      valid: v2Result.valid,
      issues: v2Result.issues.map((i) => i.code),
    });

    return json(v2Result as unknown as Record<string, unknown>, 200);
  }

  // Price rounding is a per-service DISPLAY setting (Slice 12Q follow-up rebuild).
  // It is stored as a `rounding_increment` pricing rule, but the generic `active`
  // toggle on that single row must NOT silently disable customer-facing rounding:
  // a configured positive value always rounds. Earlier this filtered the rule out
  // for home/office (whose rounding row was inactive) while move-out — with an
  // active row — kept rounding, so prices looked inconsistent by service. We now
  // resolve THIS service's OWN rounding increment regardless of the active flag
  // and inject it whenever the active rule set lacks a positive one. This is
  // strictly per-service (no cross-service borrowing) and needs no migration.
  if (service) {
    const hasActiveRounding = rules.some(
      (r) => r.rule_key === "rounding_increment" && Number(r.value_numeric) > 0,
    );
    if (!hasActiveRounding) {
      const { data: roundingRows, error: roundingError } = await admin
        .from("pricing_rules")
        .select("value_numeric")
        .eq("calculator_service_id", service.id)
        .eq("rule_key", "rounding_increment")
        .is("deleted_at", null)
        .gt("value_numeric", 0)
        .order("value_numeric", { ascending: false })
        .limit(1);
      if (roundingError) {
        console.error(
          "[public-calculator] calculate: per-service rounding load failed.",
          roundingError,
        );
      } else {
        const serviceIncrement = Number(roundingRows?.[0]?.value_numeric);
        rules = withRoundingFallback(
          rules,
          Number.isFinite(serviceIncrement) ? serviceIncrement : null,
        );
      }
    }
  }

  const result = runCalculation({ settings: settingsRow, service, plans, rules, request });

  // Log keys only (never answer VALUES — they can carry contact-ish data).
  console.log("[public-calculator] calculate", {
    functionVersion: FUNCTION_VERSION,
    slug,
    serviceKey: request.serviceKey,
    answerKeys: Object.keys(request.answers),
    valid: result.valid,
    issues: result.issues.map((i) => i.code),
  });

  return json(result as unknown as Record<string, unknown>, 200);
}

/**
 * Handles action="submit": the WRITE path. Validates + recomputes server-side,
 * then performs the ordered writes ONLY when the calculator is enabled and the
 * recompute is valid. When dark (enabled=false) or invalid, it writes NOTHING
 * and returns a safe response. The client price is never trusted — the pure
 * layer recomputes it from the loaded rows.
 */
async function handleSubmit(
  admin: AdminClient,
  body: Record<string, unknown>,
  secret: string,
): Promise<Response> {
  const slug = normalizeSlug(body.slug ?? body.publicSlug);
  if (!isValidSlug(slug)) {
    return json({ ok: false, error: "A valid public slug is required." }, 400);
  }

  // HONEYPOT: a bot filled the hidden field. Return a benign accepted-looking 200
  // and write NOTHING (this returns BEFORE any load/recompute/write), so the
  // critical write-nothing guarantee holds exactly as for the dark path.
  if (isHoneypotFilled(body)) {
    const honeypotServiceKey = typeof body.serviceKey === "string" ? body.serviceKey : null;
    console.warn("[public-calculator] submit: honeypot tripped (no write).", {
      functionVersion: FUNCTION_VERSION,
      slug,
    });
    return json(
      buildHoneypotSubmitResponse(honeypotServiceKey) as unknown as Record<string, unknown>,
      200,
    );
  }

  // Validate + normalise (REQUIRES a well-formed email; ignores any client price).
  const validation = validateSubmitRequest(body);
  if (!validation.ok) {
    return json({ ok: false, error: validation.error, field: validation.field }, 400);
  }
  const request = validation.value;

  // PER-EMAIL submit cap (anti-abuse on a single inbox, layered on top of the
  // per-IP submit limit so rotating IPs cannot flood one inbox). The email is
  // HMAC-hashed before storage — no raw email is persisted. Throttled → write
  // NOTHING. Fails open on a throttle error.
  const emailDecision = await enforceRateLimit(
    admin,
    secret,
    "email:submit",
    request.contact.email,
    EMAIL_SUBMIT_CAP,
    Date.now(),
  );
  if (!emailDecision.allowed) {
    console.warn("[public-calculator] submit: per-email cap hit (no write).", {
      functionVersion: FUNCTION_VERSION,
      slug,
    });
    return rateLimited(emailDecision.retryAfterSeconds);
  }

  // FULL settings row (submission-behaviour columns included).
  const { data: settings, error: settingsError } = await admin
    .from("calculator_settings")
    .select(SETTINGS_SUBMIT_COLUMNS)
    .eq("public_slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (settingsError) {
    console.error("[public-calculator] submit: settings load failed.", settingsError);
    return json({ ok: false, error: "Could not load the calculator." }, 500);
  }
  if (!settings) {
    return json({ ok: false, error: "not_found" }, 404);
  }
  const settingsRow = settings as CalculatorSettingsRow;

  // Match the requested service within this company (active + not soft-deleted).
  const { data: serviceRow, error: serviceError } = await admin
    .from("calculator_services")
    .select(SERVICE_COLUMNS)
    .eq("company_id", settingsRow.company_id)
    .eq("service_key", request.serviceKey)
    .is("deleted_at", null)
    .maybeSingle();
  if (serviceError) {
    console.error("[public-calculator] submit: service load failed.", serviceError);
    return json({ ok: false, error: "Could not load the service." }, 500);
  }
  const service = (serviceRow as CalculatorServiceRow | null) ?? null;

  // Company plans (to resolve the selected plan).
  const { data: planRows, error: plansError } = await admin
    .from("cleaning_plans")
    .select(PLAN_COLUMNS)
    .eq("company_id", settingsRow.company_id)
    .eq("active", true)
    .is("deleted_at", null);
  if (plansError) {
    console.error("[public-calculator] submit: plans load failed.", plansError);
    return json({ ok: false, error: "Could not load the cleaning plans." }, 500);
  }
  const plans = (planRows as CleaningPlanRow[] | null) ?? [];

  // This service's pricing rules + active questions (questions freeze the
  // per-answer label/type snapshots).
  let rules: PricingRuleRow[] = [];
  let questions: CalculatorQuestionRow[] = [];
  if (service) {
    const { data: ruleRows, error: rulesError } = await admin
      .from("pricing_rules")
      .select(RULE_COLUMNS)
      .eq("calculator_service_id", service.id)
      .eq("active", true)
      .is("deleted_at", null);
    if (rulesError) {
      console.error("[public-calculator] submit: rules load failed.", rulesError);
      return json({ ok: false, error: "Could not load the pricing rules." }, 500);
    }
    rules = (ruleRows as PricingRuleRow[] | null) ?? [];

    const { data: questionRows, error: questionsError } = await admin
      .from("calculator_questions")
      .select(QUESTION_SUBMIT_COLUMNS)
      .eq("calculator_service_id", service.id)
      .eq("active", true)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });
    if (questionsError) {
      console.error("[public-calculator] submit: questions load failed.", questionsError);
      return json({ ok: false, error: "Could not load the questions." }, 500);
    }
    questions = (questionRows as CalculatorQuestionRow[] | null) ?? [];
  }

  // Reuse a live prospect for this company + (lowercased) email when present.
  // Emails are always stored lowercase by this function, so an exact match is
  // the canonical form of the DB's lower(email) live-unique key.
  const { data: prospectRow, error: prospectLookupError } = await admin
    .from("prospects")
    .select(PROSPECT_LOOKUP_COLUMNS)
    .eq("company_id", settingsRow.company_id)
    .eq("email", request.contact.email)
    .is("deleted_at", null)
    .maybeSingle();
  if (prospectLookupError) {
    console.error("[public-calculator] submit: prospect lookup failed.", prospectLookupError);
    return json({ ok: false, error: "Could not process the submission." }, 500);
  }
  const existingProspect = (prospectRow as ExistingProspect | null) ?? null;

  // Pure preparation: (1) ENABLED gate (dark → write nothing), (2) recompute,
  // (3) reject invalid input, (4) build the row payloads + public response.
  //
  // ── Calculator V2 submit branch (Slice V2-E2b + GPM-5b-1) ───────────────────
  // Behind the SAME guard the calculate branch uses (shouldRouteServiceToV2): the
  // Home pilot OR a public/ready LITERAL generic `sqm_fixed` service. The V2 submit
  // prices through the SAME V2 core as calculate (runCalculationV2Home) and freezes
  // its result, so the public quote, the stored snapshot, and the Admin request view
  // can never diverge. Draft/non-public/unready services and legacy aliases stay on
  // the legacy prepareSubmission, which writes NOTHING for an unknown/unavailable
  // service. The returned PreparedSubmission has the SAME shape, so the ordered-write
  // code below is reused UNCHANGED.
  let prepared: PreparedSubmission;
  if (
    service &&
    shouldRouteServiceToV2({
      service,
      serviceKey: request.serviceKey,
      plans,
      rules,
      defaults: { currency: settingsRow.currency },
    })
  ) {
    let addons: CalculatorAddonRowV2[] = [];
    const { data: addonRows, error: addonsError } = await admin
      .from("calculator_addons")
      .select(ADDON_COLUMNS)
      .eq("calculator_service_id", service.id)
      .eq("active", true)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });
    if (addonsError) {
      // Non-fatal: price without add-ons rather than failing the whole submission.
      console.error(
        "[public-calculator] submit(v2): add-ons load failed (continuing without).",
        addonsError,
      );
    } else {
      addons = (addonRows as CalculatorAddonRowV2[] | null) ?? [];
    }

    // add-on selections live under answers.addonSelections (a nested object), which
    // validateSubmitRequest's flat coercion strips — so read them from the RAW body.
    prepared = prepareSubmissionV2Home({
      settings: settingsRow,
      service,
      plans,
      rules,
      questions,
      request,
      existingProspect,
      now: new Date(),
      newId,
      addons,
      addonSelections: coerceAddonSelections(body.answers),
    });
  } else {
    prepared = prepareSubmission({
      settings: settingsRow,
      service,
      plans,
      rules,
      questions,
      request,
      existingProspect,
      now: new Date(),
      newId,
    });
  }

  if (prepared.kind !== "ready") {
    // disabled (calculator dark) OR invalid — the CRITICAL rule: write NOTHING.
    console.log("[public-calculator] submit (no write)", {
      functionVersion: FUNCTION_VERSION,
      slug,
      serviceKey: request.serviceKey,
      kind: prepared.kind,
      issues: prepared.response.issues.map((i) => i.code),
    });
    return json(prepared.response as unknown as Record<string, unknown>, 200);
  }

  // ── Ordered writes (enabled + valid only) ──────────────────────────────────
  const { prospect, quoteRequest, answers } = prepared;

  // 1) Prospect: update the existing live lead (PRESERVING its CRM status) or
  //    insert a fresh one. Email is the normalised dedup key.
  let prospectId: string;
  let prospectLegacyId: string;
  if (prospect.mode === "update" && prospect.id) {
    const { data, error } = await admin
      .from("prospects")
      .update(prospect.fields)
      .eq("id", prospect.id)
      .select("id, legacy_id")
      .single();
    if (error || !data) {
      console.error("[public-calculator] submit: prospect update failed.", error);
      return json({ ok: false, error: "Could not save your details." }, 500);
    }
    prospectId = data.id as string;
    prospectLegacyId = data.legacy_id as string;
  } else {
    const { data, error } = await admin
      .from("prospects")
      .insert({ legacy_id: prospect.legacyId, ...prospect.fields })
      .select("id, legacy_id")
      .single();
    if (error || !data) {
      console.error("[public-calculator] submit: prospect insert failed.", error);
      return json({ ok: false, error: "Could not save your details." }, 500);
    }
    prospectId = data.id as string;
    prospectLegacyId = data.legacy_id as string;
  }

  // 2) Quote request: attach the prospect uuid the pure layer could not know.
  const { data: quoteData, error: quoteError } = await admin
    .from("quote_requests")
    .insert({
      ...quoteRequest.fields,
      prospect_id: prospectId,
      prospect_legacy_id: prospectLegacyId,
    })
    .select("id, legacy_id")
    .single();
  if (quoteError || !quoteData) {
    console.error("[public-calculator] submit: quote_request insert failed.", quoteError);
    return json({ ok: false, error: "Could not create your quote." }, 500);
  }
  const quoteId = quoteData.id as string;
  const quoteLegacyId = quoteData.legacy_id as string;

  // 3) Answers: one immutable snapshot per submitted answer.
  if (answers.length > 0) {
    const answerRows = answers.map((a) => ({
      legacy_id: a.legacyId,
      quote_request_id: quoteId,
      quote_request_legacy_id: quoteLegacyId,
      ...a.fields,
    }));
    const { error: answersError } = await admin
      .from("quote_request_answers")
      .insert(answerRows);
    if (answersError) {
      // Compensating soft-delete: never leave a quote without its frozen answer
      // snapshots. The (idempotent) prospect is kept — a retry reuses it.
      console.error(
        "[public-calculator] submit: answers insert failed; rolling back quote.",
        answersError,
      );
      await admin
        .from("quote_requests")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", quoteId);
      return json({ ok: false, error: "Could not save your answers." }, 500);
    }
  }

  // Log business ids + counts only — never contact PII or answer VALUES.
  console.log("[public-calculator] submit (written)", {
    functionVersion: FUNCTION_VERSION,
    slug,
    serviceKey: request.serviceKey,
    prospectMode: prospect.mode,
    quoteRequestLegacyId: quoteLegacyId,
    answerCount: answers.length,
    requiresManualReview: prepared.response.requiresManualReview,
  });

  return json(prepared.response as unknown as Record<string, unknown>, 200);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[public-calculator] Missing required runtime env.");
    return json({ ok: false, error: "Server is not configured." }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";

  // Privileged admin client (service role). NEVER returned to the browser. The
  // calculator tables have no anon RLS, so the service role is the only way to
  // read them — the public-safety filtering happens in the pure layer.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // PER-IP rate limit (all actions; submit is the strictest). Skipped only when
  // no client IP can be determined (fail open) so a missing forwarding header
  // never blocks legitimate traffic. The IP is HMAC-hashed before storage — no
  // raw IP is persisted. This writes only the hashed counter (never business
  // data), so it is safe to run even while the calculator is dark.
  const clientIp = extractClientIp((name) => req.headers.get(name));
  if (clientIp) {
    const ipPlan = resolveIpRateLimit(action);
    const ipDecision = await enforceRateLimit(
      admin,
      serviceRoleKey,
      `ip:${action}`,
      clientIp,
      ipPlan,
      Date.now(),
    );
    if (!ipDecision.allowed) {
      console.warn("[public-calculator] ip rate limit hit.", {
        functionVersion: FUNCTION_VERSION,
        action,
      });
      return rateLimited(ipDecision.retryAfterSeconds);
    }
  }

  try {
    switch (action) {
      case "config":
        return await handleConfig(admin, body);
      case "calculate":
        return await handleCalculate(admin, body);
      case "submit":
        return await handleSubmit(admin, body, serviceRoleKey);
      default:
        return json(
          { ok: false, error: 'Unknown action. Use "config", "calculate", or "submit".' },
          400,
        );
    }
  } catch (err) {
    console.error("[public-calculator] Unhandled error.", err);
    return json({ ok: false, error: "Unexpected server error." }, 500);
  }
});
