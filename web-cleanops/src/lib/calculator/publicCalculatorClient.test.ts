import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_GENERIC_SERVICE_METADATA,
  fetchPublicCalculatorConfig,
  HONEYPOT_FIELD,
  isLikelyEmail,
  normalizePublicCalculateResponse,
  normalizePublicConfigResponse,
  normalizePublicSubmitResponse,
  parseCalculatorContent,
  parseCalculatorFaq,
  PublicCalculatorError,
  requestPublicCalculation,
  resolveResultView,
  submitPublicQuoteRequest,
  type PublicCalculateResponse,
} from "./publicCalculatorClient";

/**
 * Unit tests for the PUBLIC (unauthenticated) calculator client. They pin the
 * exact Edge Function contract the public page relies on: the request URL, the
 * anon auth headers, the action payloads, and the result/error mapping. fetch is
 * fully mocked — no network, no Supabase.
 */

const SUPABASE_URL = "https://test.supabase.co";
const ANON_KEY = "test-anon-key";
const SLUG = "rakna-ut-ditt-pris";
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/public-calculator`;

const fetchMock = vi.fn();

function mockResponseOnce(status: number, payload: unknown): void {
  fetchMock.mockResolvedValueOnce({
    status,
    json: async () => payload,
  } as unknown as Response);
}

/** Returns the parsed body + headers of the Nth fetch call. */
function callBody(index = 0): { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return {
    url,
    method: String(init.method),
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
}

beforeEach(() => {
  vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchPublicCalculatorConfig", () => {
  it("POSTs the config action to the function with anon auth headers", async () => {
    mockResponseOnce(200, { ok: true, enabled: false, services: [], cleaningPlans: [] });

    await fetchPublicCalculatorConfig(SLUG);

    const call = callBody();
    expect(call.url).toBe(FUNCTION_URL);
    expect(call.method).toBe("POST");
    expect(call.headers.apikey).toBe(ANON_KEY);
    expect(call.headers.Authorization).toBe(`Bearer ${ANON_KEY}`);
    expect(call.body).toEqual({ action: "config", slug: SLUG });
  });

  it("returns the config on ok:true", async () => {
    mockResponseOnce(200, { ok: true, enabled: true, services: [], cleaningPlans: [] });

    const result = await fetchPublicCalculatorConfig(SLUG);

    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.config.enabled).toBe(true);
  });

  it("maps HTTP 404 to an explicit not_found", async () => {
    mockResponseOnce(404, { ok: false, error: "not_found" });

    const result = await fetchPublicCalculatorConfig(SLUG);

    expect(result.status).toBe("not_found");
  });

  it("maps ok:false to an error result (never throws)", async () => {
    mockResponseOnce(500, { ok: false, error: "Could not load the calculator." });

    const result = await fetchPublicCalculatorConfig(SLUG);

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.message).toBe("Could not load the calculator.");
  });
});

describe("requestPublicCalculation", () => {
  it("sends serviceKey, answers and cleaningPlanKey when a plan is selected", async () => {
    mockResponseOnce(200, { ok: true, enabled: true, valid: true, issues: [], displayText: "x" });

    await requestPublicCalculation(SLUG, {
      serviceKey: "home_cleaning",
      answers: { sqm: 70, bathrooms: 1, addons: ["oven"] },
      cleaningPlanKey: "flexible",
    });

    expect(callBody().body).toEqual({
      action: "calculate",
      slug: SLUG,
      serviceKey: "home_cleaning",
      answers: { sqm: 70, bathrooms: 1, addons: ["oven"] },
      cleaningPlanKey: "flexible",
    });
  });

  it("omits cleaningPlanKey entirely when none is supplied (move-out)", async () => {
    mockResponseOnce(200, { ok: true, enabled: true, valid: true, issues: [], displayText: "x" });

    await requestPublicCalculation(SLUG, {
      serviceKey: "move_out_cleaning",
      answers: { sqm: 70 },
      cleaningPlanKey: null,
    });

    expect(callBody().body).toEqual({
      action: "calculate",
      slug: SLUG,
      serviceKey: "move_out_cleaning",
      answers: { sqm: 70 },
    });
    expect("cleaningPlanKey" in callBody().body).toBe(false);
  });

  it("merges addonSelections into the wire answers under answers.addonSelections (GPM-10-C)", async () => {
    mockResponseOnce(200, { ok: true, enabled: true, valid: true, issues: [], displayText: "x" });

    await requestPublicCalculation(SLUG, {
      serviceKey: "flyttstad_sqm",
      answers: { sqm: 80 },
      cleaningPlanKey: "normal",
      addonSelections: { balcony: true, windows: 3 },
    });

    expect(callBody().body).toEqual({
      action: "calculate",
      slug: SLUG,
      serviceKey: "flyttstad_sqm",
      answers: { sqm: 80, addonSelections: { balcony: true, windows: 3 } },
      cleaningPlanKey: "normal",
    });
  });

  it("omits addonSelections from the wire answers when empty (exact established payload)", async () => {
    mockResponseOnce(200, { ok: true, enabled: true, valid: true, issues: [], displayText: "x" });

    await requestPublicCalculation(SLUG, {
      serviceKey: "flyttstad_sqm",
      answers: { sqm: 80 },
      cleaningPlanKey: "normal",
      addonSelections: {},
    });

    const body = callBody().body;
    expect(body.answers).toEqual({ sqm: 80 });
    expect("addonSelections" in (body.answers as Record<string, unknown>)).toBe(false);
  });

  it("returns the server response on ok:true", async () => {
    mockResponseOnce(200, {
      ok: true,
      enabled: true,
      valid: true,
      issues: [],
      displayText: "2 100–2 600 kr",
      calculatedPrice: 2350,
    });

    const result = await requestPublicCalculation(SLUG, { serviceKey: "home_cleaning", answers: { sqm: 70 } });

    expect(result.valid).toBe(true);
    expect(result.displayText).toBe("2 100–2 600 kr");
  });

  it("throws a PublicCalculatorError on a non-ok response", async () => {
    mockResponseOnce(400, { ok: false, error: "A valid serviceKey is required." });

    await expect(
      requestPublicCalculation(SLUG, { serviceKey: "", answers: {} }),
    ).rejects.toBeInstanceOf(PublicCalculatorError);
  });
});

describe("content + faq parsing", () => {
  it("maps editable content slots defensively", () => {
    const content = parseCalculatorContent({
      pageTitle: "Räkna ut ditt pris",
      pageSubtitle: "Snabbt och enkelt",
      backToWebsite: { label: "Tillbaka", href: "/" },
      contactHelp: { heading: "Hjälp?", email: "hej@example.se", phone: "0700000000" },
      ctaLabels: { submitQuote: "Skicka offertförfrågan" },
    });

    expect(content.pageTitle).toBe("Räkna ut ditt pris");
    expect(content.backToWebsite).toEqual({ label: "Tillbaka", href: "/" });
    expect(content.contactHelp?.email).toBe("hej@example.se");
    expect(content.ctaLabels.submitQuote).toBe("Skicka offertförfrågan");
    // Missing slots resolve to null rather than throwing.
    expect(content.introText).toBeNull();
  });

  it("keeps only well-formed FAQ entries (supports q/a and question/answer)", () => {
    const faq = parseCalculatorFaq([
      { q: "Hur beräknas priset?", a: "Per yta." },
      { question: "Är priset bindande?", answer: "Nej." },
      { q: "Saknar svar" },
      "not-an-object",
    ]);

    expect(faq).toHaveLength(2);
    expect(faq[0]).toEqual({ question: "Hur beräknas priset?", answer: "Per yta." });
  });

  it("drops unknown/sensitive keys carried on FAQ items (keeps only question/answer)", () => {
    const faq = parseCalculatorFaq([
      { q: "Fråga?", a: "Svar.", internalNotes: "secret", ruleTrace: [1, 2], adminOnly: true },
    ]);

    expect(faq).toEqual([{ question: "Fråga?", answer: "Svar." }]);
    expect(Object.keys(faq[0]).sort()).toEqual(["answer", "question"]);
  });
});

// ── runtime validation + sensitive-field stripping ───────────────────────────
//
// The Edge Function is trusted, but a stale deploy or a future bug could return a
// malformed/partial payload or an internal-only field. These tests pin the
// browser-side contract: drop unknown keys, coerce to safe defaults, filter bad
// array items, and NEVER surface internal data in the public DTO.

/** The exact set of internal-only fields that must never reach the public DTO. */
const SENSITIVE_KEYS = [
  "rawPricingRules",
  "pricingRules",
  "marginPercent",
  "internalNotes",
  "crmStatus",
  "ruleTrace",
  "stack",
  "debug",
  "adminOnly",
  "calculationTrace",
  "costBreakdownInternal",
] as const;

/** A blob of every internal-only field, spread onto a payload to prove they drop. */
function sensitiveBlob(): Record<string, unknown> {
  return {
    rawPricingRules: [{ kind: "per_sqm", value: 999 }],
    pricingRules: [{ id: "rule_1", op: "multiply" }],
    marginPercent: 42,
    internalNotes: "internal only — do not expose",
    crmStatus: "qualified",
    ruleTrace: ["base", "plan", "addons"],
    stack: "Error: boom\n  at calc()",
    debug: { sql: "select * from pricing_rules" },
    adminOnly: true,
    calculationTrace: [{ step: "base", amount: 100 }],
    costBreakdownInternal: { labor: 100, overhead: 50 },
  };
}

/** Recursively asserts none of the SENSITIVE_KEYS appear anywhere in `value`. */
function expectNoSensitiveKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(expectNoSensitiveKeys);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      expect(SENSITIVE_KEYS).not.toContain(key);
      expectNoSensitiveKeys(child);
    }
  }
}

describe("normalizePublicConfigResponse", () => {
  it("returns null for a fundamentally malformed payload (ok !== true)", () => {
    expect(normalizePublicConfigResponse(null)).toBeNull();
    expect(normalizePublicConfigResponse("nope")).toBeNull();
    expect(normalizePublicConfigResponse({ ok: false, error: "x" })).toBeNull();
    expect(normalizePublicConfigResponse({ enabled: true })).toBeNull();
  });

  it("coerces a partial ok payload to safe defaults instead of throwing", () => {
    const config = normalizePublicConfigResponse({ ok: true });

    expect(config).not.toBeNull();
    expect(config?.enabled).toBe(false); // missing enabled → safe-off default
    expect(config?.services).toEqual([]); // missing services → empty list
    expect(config?.cleaningPlans).toEqual([]);
    expect(config?.faq).toEqual([]);
    expect(config?.company).toBeNull();
    expect(config?.settings.currency).toBe("SEK"); // defaulted settings
    expect(config?.settings.priceDisplayMode).toBe("range");
  });

  it("keeps only well-formed services and drops items missing a serviceKey", () => {
    const config = normalizePublicConfigResponse({
      ok: true,
      enabled: true,
      services: [
        { serviceKey: "home_cleaning", displayName: "Hemstädning", enabled: true, questions: [] },
        { displayName: "Broken — no key" },
        "not-an-object",
      ],
    });

    expect(config?.services).toHaveLength(1);
    expect(config?.services[0]?.serviceKey).toBe("home_cleaning");
  });

  it("preserves planPricingModel time_adjustment_per_visit and defaults unknown values", () => {
    const config = normalizePublicConfigResponse({
      ok: true,
      enabled: true,
      services: [
        {
          serviceKey: "home_cleaning",
          displayName: "Hemstädning",
          enabled: true,
          plansEnabled: true,
          planPricingModel: "time_adjustment_per_visit",
          questions: [],
        },
        {
          serviceKey: "office_cleaning",
          displayName: "Kontorsstädning",
          enabled: true,
          planPricingModel: "totally_bogus",
          questions: [],
        },
      ],
    });

    expect(config?.services[0]?.planPricingModel).toBe("time_adjustment_per_visit");
    // An unknown model collapses to the safe default (never crashes the page).
    expect(config?.services[1]?.planPricingModel).toBe("hourly_rate_by_plan");
  });

  it("filters malformed questions but keeps the service (missing questions → empty)", () => {
    const config = normalizePublicConfigResponse({
      ok: true,
      enabled: true,
      services: [
        {
          serviceKey: "home_cleaning",
          displayName: "Hemstädning",
          enabled: true,
          questions: [
            { questionKey: "sqm", label: "Yta", inputType: "number", required: true },
            { label: "Broken — no key" },
          ],
        },
        { serviceKey: "no_questions", displayName: "Utan frågor", enabled: true },
      ],
    });

    expect(config?.services[0]?.questions).toHaveLength(1);
    expect(config?.services[0]?.questions[0]?.questionKey).toBe("sqm");
    // A service that omits questions entirely normalizes to an empty list (no crash).
    expect(config?.services[1]?.questions).toEqual([]);
  });

  it("handles a disabled config that still carries partial data", () => {
    const config = normalizePublicConfigResponse({
      ok: true,
      enabled: false,
      services: [{ serviceKey: "home_cleaning", displayName: "Hemstädning", enabled: true }],
      cleaningPlans: "corrupt",
    });

    expect(config?.enabled).toBe(false);
    expect(config?.cleaningPlans).toEqual([]); // non-array → empty, never throws
    expect(config?.services).toHaveLength(1);
  });

  it("strips ALL internal-only fields from the top level, services, plans and settings", () => {
    const config = normalizePublicConfigResponse({
      ok: true,
      enabled: true,
      ...sensitiveBlob(),
      company: { name: "Städalliansen Sverige AB", ...sensitiveBlob() },
      settings: { currency: "SEK", priceDisplayMode: "range", ...sensitiveBlob() },
      services: [
        {
          serviceKey: "home_cleaning",
          displayName: "Hemstädning",
          enabled: true,
          ...sensitiveBlob(),
          questions: [{ questionKey: "sqm", label: "Yta", inputType: "number", required: true }],
        },
      ],
      cleaningPlans: [{ planKey: "flexible", name: "Flexibel", hourlyRate: 349, ...sensitiveBlob() }],
    });

    expect(config).not.toBeNull();
    // The top-level DTO has EXACTLY the public keys — nothing extra leaked in.
    expect(Object.keys(config as object).sort()).toEqual([
      "cleaningPlans",
      "company",
      "content",
      "enabled",
      "faq",
      "ok",
      "services",
      "settings",
    ]);
    expectNoSensitiveKeys(config?.company);
    expectNoSensitiveKeys(config?.settings);
    expectNoSensitiveKeys(config?.services);
    expectNoSensitiveKeys(config?.cleaningPlans);
  });
});

// ── generic service metadata (GPM-5c-2) ──────────────────────────────────────
//
// GPM-5c-1 added four ADDITIVE public-config fields per service. GPM-5c-2 teaches
// the client to RECEIVE them safely (DTO/normalization only — no rendering yet):
// the complete payload is preserved, older payloads that omit the fields default
// safely, legacy/Home stays null/false, and a missing/mistyped/orphaned payload
// can never FABRICATE an engine-supported service.

describe("normalizePublicConfigResponse — generic service metadata (GPM-5c-2)", () => {
  /** Normalizes one service payload through the real config path and returns it. */
  function serviceFromConfig(servicePayload: Record<string, unknown>) {
    const config = normalizePublicConfigResponse({
      ok: true,
      enabled: true,
      services: [servicePayload],
    });
    return config?.services[0];
  }

  it("preserves the complete GPM-5c-1 payload (literal sqm_fixed → engine-supported, sqm, m²)", () => {
    const svc = serviceFromConfig({
      serviceKey: "garden_sqm",
      displayName: "Trädgård (m²)",
      enabled: true,
      pricingModel: "sqm_fixed",
      genericPricingModel: "sqm_fixed",
      engineSupported: true,
      primaryInput: "sqm",
      unitLabel: "m²",
      questions: [],
    });

    expect(svc?.genericPricingModel).toBe("sqm_fixed");
    expect(svc?.engineSupported).toBe(true);
    expect(svc?.primaryInput).toBe("sqm");
    expect(svc?.unitLabel).toBe("m²");
  });

  it("defaults safely when an older deploy omits the generic fields entirely", () => {
    const svc = serviceFromConfig({
      serviceKey: "home_cleaning",
      displayName: "Hemstädning",
      enabled: true,
      questions: [],
    });

    // The four fields collapse to exactly the documented safe defaults.
    expect({
      genericPricingModel: svc?.genericPricingModel,
      engineSupported: svc?.engineSupported,
      primaryInput: svc?.primaryInput,
      unitLabel: svc?.unitLabel,
    }).toEqual(DEFAULT_GENERIC_SERVICE_METADATA);
  });

  it("normalizes legacy/Home metadata to null model + engine NOT supported", () => {
    // The server reports null/false for a legacy service-named model (never alias-resolved).
    const svc = serviceFromConfig({
      serviceKey: "move_out_cleaning",
      displayName: "Flyttstädning",
      enabled: true,
      pricingModel: "move_out_fixed_plus_addons",
      genericPricingModel: null,
      engineSupported: false,
      primaryInput: null,
      unitLabel: null,
      questions: [],
    });

    expect(svc?.genericPricingModel).toBeNull();
    expect(svc?.engineSupported).toBe(false);
    expect(svc?.primaryInput).toBeNull();
    expect(svc?.unitLabel).toBeNull();
  });

  it("never fabricates engineSupported=true from mistyped fields (and never crashes)", () => {
    const svc = serviceFromConfig({
      serviceKey: "broken_meta",
      displayName: "Trasig metadata",
      enabled: true,
      genericPricingModel: 123, // not a string → null
      engineSupported: "true", // not a REAL boolean → false
      primaryInput: "square_meters", // not the literal "sqm" → null
      unitLabel: 42, // not a string → null
      questions: [],
    });

    expect(svc).toBeDefined();
    expect(svc?.serviceKey).toBe("broken_meta");
    expect(svc?.genericPricingModel).toBeNull();
    expect(svc?.engineSupported).toBe(false);
    expect(svc?.primaryInput).toBeNull();
    expect(svc?.unitLabel).toBeNull();
  });

  it("refuses an ORPHANED engineSupported=true that arrives without a generic model", () => {
    // A real boolean true, but no genericPricingModel → must collapse to false so the
    // client can never present an engine-supported service the server never classified.
    const svc = serviceFromConfig({
      serviceKey: "orphan_engine",
      displayName: "Orphan",
      enabled: true,
      engineSupported: true,
      primaryInput: "sqm",
      unitLabel: "m²",
      questions: [],
    });

    expect(svc?.genericPricingModel).toBeNull();
    expect(svc?.engineSupported).toBe(false);
  });

  it("trusts the server's false for a present-but-unsupported model (hourly_by_area)", () => {
    // hourly_by_area is a valid generic model but NOT engine-supported today. The client
    // keeps the model string and the server's false — it never re-derives true from the model.
    const svc = serviceFromConfig({
      serviceKey: "lawn_hourly",
      displayName: "Gräsklippning",
      enabled: true,
      pricingModel: "hourly_by_area",
      genericPricingModel: "hourly_by_area",
      engineSupported: false,
      primaryInput: "sqm",
      unitLabel: "m²",
      questions: [],
    });

    expect(svc?.genericPricingModel).toBe("hourly_by_area");
    expect(svc?.engineSupported).toBe(false);
    expect(svc?.primaryInput).toBe("sqm");
    expect(svc?.unitLabel).toBe("m²");
  });

  it("does not leak the generic fields as a sensitive channel (keys stay public-safe)", () => {
    const svc = serviceFromConfig({
      serviceKey: "garden_sqm",
      displayName: "Trädgård",
      enabled: true,
      genericPricingModel: "sqm_fixed",
      engineSupported: true,
      primaryInput: "sqm",
      unitLabel: "m²",
      questions: [],
    });

    // The new fields are present and public-safe; no internal-only keys rode along.
    expectNoSensitiveKeys(svc);
    expect(svc && "genericPricingModel" in svc).toBe(true);
    expect(svc && "engineSupported" in svc).toBe(true);
  });
});

describe("normalizePublicCalculateResponse", () => {
  it("returns null when the payload is unusable (ok !== true or non-boolean valid)", () => {
    expect(normalizePublicCalculateResponse(null)).toBeNull();
    expect(normalizePublicCalculateResponse({ ok: false })).toBeNull();
    expect(normalizePublicCalculateResponse({ ok: true })).toBeNull(); // missing valid
    expect(normalizePublicCalculateResponse({ ok: true, valid: "yes" })).toBeNull();
  });

  it("keeps issue codes while coercing an absent price to null (no fake number)", () => {
    const result = normalizePublicCalculateResponse({
      ok: true,
      enabled: true,
      valid: false,
      issues: [
        { code: "missing_field", field: "sqm", message: "Ange boyta." },
        "not-an-issue",
      ],
      calculatedPrice: "oops",
      estimatedHours: Number.NaN,
      displayText: "",
    });

    expect(result?.valid).toBe(false);
    expect(result?.issues).toHaveLength(1); // malformed issue filtered out
    expect(result?.issues[0]?.code).toBe("missing_field");
    expect(result?.calculatedPrice).toBeNull(); // string price → null
    expect(result?.estimatedHours).toBeNull(); // NaN → null
  });

  it("strips ALL internal-only fields from the calculate DTO, issues and selectedPlan", () => {
    const result = normalizePublicCalculateResponse({
      ok: true,
      enabled: true,
      valid: true,
      ...sensitiveBlob(),
      issues: [{ code: "info", message: "ok", ...sensitiveBlob() }],
      serviceKey: "home_cleaning",
      displayText: "2 100–2 600 kr",
      calculatedPrice: 2350,
      selectedPlan: { planKey: "flexible", name: "Flexibel", hourlyRate: 349, ...sensitiveBlob() },
    });

    expect(result).not.toBeNull();
    expect(Object.keys(result as object).sort()).toEqual([
      "calculatedPrice",
      "currency",
      "displayText",
      "enabled",
      "estimatedHours",
      "formulaVersion",
      "issues",
      "maxPrice",
      "minPrice",
      "ok",
      "priceAfterRut",
      "priceDisplayMode",
      "priceExclVat",
      "priceInclVat",
      "pricingModel",
      "roundingIncrement",
      "rutDeduction",
      "rutEnabled",
      "rutPercent",
      "selectedPlan",
      "serviceKey",
      "showRutBreakdown",
      "valid",
      "vatAmount",
      "vatRatePercent",
    ]);
    expectNoSensitiveKeys(result?.issues);
    expectNoSensitiveKeys(result?.selectedPlan);
  });
});

describe("transport / network errors", () => {
  it("fetchPublicCalculatorConfig maps a thrown fetch error to an error result (never throws)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const result = await fetchPublicCalculatorConfig(SLUG);

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.message).toBe("network down");
  });

  it("fetchPublicCalculatorConfig maps a malformed (non-JSON) body to an error result", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: async () => {
        throw new Error("invalid json");
      },
    } as unknown as Response);

    const result = await fetchPublicCalculatorConfig(SLUG);

    expect(result.status).toBe("error");
  });

  it("requestPublicCalculation rejects on a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    await expect(
      requestPublicCalculation(SLUG, { serviceKey: "home_cleaning", answers: { sqm: 70 } }),
    ).rejects.toThrow("network down");
  });

  it("requestPublicCalculation throws when a 200 body is malformed/unusable", async () => {
    mockResponseOnce(200, { ok: true /* missing boolean valid → unusable */ });

    await expect(
      requestPublicCalculation(SLUG, { serviceKey: "home_cleaning", answers: { sqm: 70 } }),
    ).rejects.toBeInstanceOf(PublicCalculatorError);
  });
});

describe("resolveResultView", () => {
  const validCalc: PublicCalculateResponse = {
    ok: true,
    enabled: true,
    valid: true,
    issues: [],
    serviceKey: "home_cleaning",
    pricingModel: "home_cleaning_recommended_hours",
    formulaVersion: "v1",
    currency: "SEK",
    priceDisplayMode: "range",
    estimatedHours: 3,
    calculatedPrice: 2350,
    minPrice: 2100,
    maxPrice: 2600,
    priceExclVat: null,
    vatRatePercent: 25,
    vatAmount: null,
    priceInclVat: null,
    rutEnabled: false,
    rutPercent: 0,
    showRutBreakdown: false,
    rutDeduction: null,
    priceAfterRut: null,
    roundingIncrement: null,
    displayText: "2 100–2 600 kr",
    selectedPlan: { planKey: "flexible", name: "Flexibel", hourlyRate: 349, vatRatePercent: 25, rutEnabled: false, rutPercent: 0, showRutBreakdown: false },
  };

  it("is idle before the inputs are ready", () => {
    const view = resolveResultView({ isReady: false, isFetching: false, isError: false, inputsSettled: true, calc: null });
    expect(view.status).toBe("idle");
    expect(view.displayText).toBe("");
  });

  it("is error when the last request failed", () => {
    const view = resolveResultView({ isReady: true, isFetching: false, isError: true, inputsSettled: true, calc: null });
    expect(view.status).toBe("error");
  });

  it("is updating while a request is in flight", () => {
    const view = resolveResultView({ isReady: true, isFetching: true, isError: false, inputsSettled: true, calc: null });
    expect(view.status).toBe("updating");
  });

  it("is valid with figures once settled on a valid result", () => {
    const view = resolveResultView({ isReady: true, isFetching: false, isError: false, inputsSettled: true, calc: validCalc });
    expect(view.status).toBe("valid");
    expect(view.displayText).toBe("2 100–2 600 kr");
    expect(view.estimatedHours).toBe(3);
    expect(view.planName).toBe("Flexibel");
    expect(view.planRate).toBe(349);
  });

  it("is invalid with issue messages when settled on a valid:false result", () => {
    const view = resolveResultView({
      isReady: true,
      isFetching: false,
      isError: false,
      inputsSettled: true,
      calc: { ...validCalc, valid: false, issues: [{ code: "missing_field", field: "sqm", message: "Ange boyta." }] },
    });
    expect(view.status).toBe("invalid");
    expect(view.issues).toEqual(["Ange boyta."]);
    expect(view.displayText).toBe("");
  });

  it("STALE GUARD: never shows a result as final once inputs move ahead of it", () => {
    // A valid figure exists, but the live inputs have changed (inputsSettled=false):
    // the panel must report `updating` (dimmed), NEVER `valid`.
    const view = resolveResultView({ isReady: true, isFetching: false, isError: false, inputsSettled: false, calc: validCalc });
    expect(view.status).toBe("updating");
    // Previous figures are still carried so the panel can dim rather than flicker empty.
    expect(view.displayText).toBe("2 100–2 600 kr");
  });

  it("defensive fallback: ready+settled but no usable calc → updating (never crashes, never final)", () => {
    // The normalized calculate result is absent (e.g. a malformed/unusable body was
    // dropped upstream and no fetch is flagged in flight). Inputs are ready and
    // settled with no transport error, yet there is nothing safe to show as final:
    // the panel must stay in a benign `updating` state — never crash, and never
    // present a missing result as a final price.
    const view = resolveResultView({ isReady: true, isFetching: false, isError: false, inputsSettled: true, calc: null });
    expect(view.status).toBe("updating");
    expect(view.displayText).toBe("");
    expect(view.issues).toEqual([]);
  });

  it("race condition (B after A): the late A response can never overwrite B's result", () => {
    // The page keys each calculation by its request signature (React Query) and the
    // `inputsSettled` guard below; together they make the late loser unreachable.
    const calcA: PublicCalculateResponse = { ...validCalc, displayText: "A: 1 000 kr", calculatedPrice: 1000 };
    const calcB: PublicCalculateResponse = { ...validCalc, displayText: "B: 2 000 kr", calculatedPrice: 2000 };

    // 1) Settled on A's result.
    let view = resolveResultView({ isReady: true, isFetching: false, isError: false, inputsSettled: true, calc: calcA });
    expect(view.status).toBe("valid");
    expect(view.displayText).toBe("A: 1 000 kr");

    // 2) User edits to B → inputs move ahead; A is no longer final (updating, not valid).
    view = resolveResultView({ isReady: true, isFetching: true, isError: false, inputsSettled: false, calc: calcA });
    expect(view.status).toBe("updating");

    // 3) B settles → the panel shows B. The late A response targets A's cache key and
    //    is never read for the active B request, so it cannot overwrite B.
    view = resolveResultView({ isReady: true, isFetching: false, isError: false, inputsSettled: true, calc: calcB });
    expect(view.status).toBe("valid");
    expect(view.displayText).toBe("B: 2 000 kr");
  });
});

// ── submit (write path) ─────────────────────────────────────────────────
//
// The submit path mirrors calculate (serviceKey/answers/plan) and adds a contact
// object + sourceUrl. These pin the exact wire payload (the client price is NEVER
// sent), the resolve-vs-throw contract, and that the normalized response never
// carries internal-only fields or uuids.

describe("submitPublicQuoteRequest", () => {
  const CONTACT = {
    name: "Test Kund",
    email: "test@example.com",
    phone: "0700000000",
    postalCode: "41700",
  };

  it("POSTs the submit action with serviceKey, answers, cleaningPlanKey, contact and sourceUrl", async () => {
    mockResponseOnce(200, { ok: true, enabled: true, available: true, valid: true, issues: [], displayText: "x", status: "submitted" });

    await submitPublicQuoteRequest(SLUG, {
      serviceKey: "home_cleaning",
      answers: { sqm: 70, bathrooms: 1, addons: ["oven"] },
      cleaningPlanKey: "flexible",
      contact: CONTACT,
      sourceUrl: "https://stadportalen.se/rakna-ut-ditt-pris",
    });

    const call = callBody();
    expect(call.headers.apikey).toBe(ANON_KEY);
    expect(call.body).toEqual({
      action: "submit",
      slug: SLUG,
      serviceKey: "home_cleaning",
      answers: { sqm: 70, bathrooms: 1, addons: ["oven"] },
      cleaningPlanKey: "flexible",
      contact: { name: "Test Kund", email: "test@example.com", phone: "0700000000", postalCode: "41700" },
      sourceUrl: "https://stadportalen.se/rakna-ut-ditt-pris",
    });
  });

  it("merges addonSelections into the submit wire answers under answers.addonSelections (GPM-10-C)", async () => {
    mockResponseOnce(200, { ok: true, enabled: true, available: true, valid: true, issues: [], displayText: "x", status: "submitted" });

    await submitPublicQuoteRequest(SLUG, {
      serviceKey: "flyttstad_sqm",
      answers: { sqm: 80 },
      cleaningPlanKey: "normal",
      addonSelections: { balcony: true },
      contact: { email: "a@b.co" },
    });

    const body = callBody().body;
    expect(body.answers).toEqual({ sqm: 80, addonSelections: { balcony: true } });
  });

  it("omits cleaningPlanKey for move-out (no plan) and nulls optional contact fields", async () => {
    mockResponseOnce(200, { ok: true, enabled: true, available: true, valid: true, issues: [], displayText: "x" });

    await submitPublicQuoteRequest(SLUG, {
      serviceKey: "move_out_cleaning",
      answers: { sqm: 70 },
      cleaningPlanKey: null,
      contact: { email: "only@example.com" },
    });

    const body = callBody().body;
    expect("cleaningPlanKey" in body).toBe(false);
    expect(body.contact).toEqual({ name: null, email: "only@example.com", phone: null, postalCode: null });
    expect("sourceUrl" in body).toBe(false);
  });

  it("never sends a client-calculated price in the submit payload", async () => {
    mockResponseOnce(200, { ok: true, enabled: true, available: true, valid: true, issues: [], displayText: "x" });

    await submitPublicQuoteRequest(SLUG, {
      serviceKey: "home_cleaning",
      answers: { sqm: 70 },
      cleaningPlanKey: "flexible",
      contact: { email: "a@b.co" },
    });

    const keys = Object.keys(callBody().body);
    for (const forbidden of ["price", "calculatedPrice", "minPrice", "maxPrice", "displayText", "estimatedHours"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("returns the normalized response on ok:true (resolves valid:false instead of throwing)", async () => {
    mockResponseOnce(200, {
      ok: true,
      enabled: true,
      available: true,
      valid: false,
      issues: [{ code: "missing_field", field: "sqm", message: "Ange boyta." }],
      displayText: "",
    });

    const res = await submitPublicQuoteRequest(SLUG, {
      serviceKey: "home_cleaning",
      answers: {},
      cleaningPlanKey: "flexible",
      contact: { email: "a@b.co" },
    });

    expect(res.valid).toBe(false);
    expect(res.available).toBe(true);
    expect(res.issues[0]?.code).toBe("missing_field");
  });

  it("throws a PublicCalculatorError on a non-200 response", async () => {
    mockResponseOnce(400, { ok: false, error: "An email address is required." });

    await expect(
      submitPublicQuoteRequest(SLUG, { serviceKey: "home_cleaning", answers: { sqm: 70 }, contact: { email: "" } }),
    ).rejects.toBeInstanceOf(PublicCalculatorError);
  });

  it("throws when a 200 body is malformed/unusable (ok !== true)", async () => {
    mockResponseOnce(200, { enabled: true /* no ok:true */ });

    await expect(
      submitPublicQuoteRequest(SLUG, { serviceKey: "home_cleaning", answers: { sqm: 70 }, contact: { email: "a@b.co" } }),
    ).rejects.toBeInstanceOf(PublicCalculatorError);
  });

  it("rejects on a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    await expect(
      submitPublicQuoteRequest(SLUG, { serviceKey: "home_cleaning", answers: { sqm: 70 }, contact: { email: "a@b.co" } }),
    ).rejects.toThrow("network down");
  });

  // ── honeypot (Slice 12B) ──────────────────────────────────────────────────

  it("OMITS the honeypot field from a normal submit (empty/absent → unchanged wire body)", async () => {
    mockResponseOnce(200, { ok: true, enabled: true, available: true, valid: true, issues: [], displayText: "x" });

    await submitPublicQuoteRequest(SLUG, {
      serviceKey: "home_cleaning",
      answers: { sqm: 70 },
      cleaningPlanKey: "flexible",
      contact: { email: "a@b.co" },
      honeypot: "   ", // whitespace-only behaves like empty
    });

    expect(HONEYPOT_FIELD in callBody().body).toBe(false);
  });

  it("INCLUDES the honeypot field (trimmed) only when a bot has filled it", async () => {
    mockResponseOnce(200, { ok: true, enabled: true, available: true, valid: true, issues: [], displayText: "x" });

    await submitPublicQuoteRequest(SLUG, {
      serviceKey: "home_cleaning",
      answers: { sqm: 70 },
      cleaningPlanKey: "flexible",
      contact: { email: "a@b.co" },
      honeypot: "  http://spam.example  ",
    });

    expect(callBody().body[HONEYPOT_FIELD]).toBe("http://spam.example");
  });

  // ── rate limiting (Slice 12B) ─────────────────────────────────────────────

  it("throws a rate-limited PublicCalculatorError on HTTP 429 (friendly message + retryAfter)", async () => {
    mockResponseOnce(429, {
      ok: false,
      error: "rate_limited",
      message: "För många förfrågningar just nu. Vänta en liten stund och försök igen.",
      retryAfterSeconds: 42,
    });

    const promise = submitPublicQuoteRequest(SLUG, {
      serviceKey: "home_cleaning",
      answers: { sqm: 70 },
      cleaningPlanKey: "flexible",
      contact: { email: "a@b.co" },
    });

    await expect(promise).rejects.toBeInstanceOf(PublicCalculatorError);
    await promise.catch((err: unknown) => {
      expect(err).toBeInstanceOf(PublicCalculatorError);
      const e = err as PublicCalculatorError;
      expect(e.rateLimited).toBe(true);
      expect(e.retryAfterSeconds).toBe(42);
      expect(e.message).toMatch(/För många förfrågningar/i);
    });
  });

  it("uses a friendly fallback message when a 429 body omits one", async () => {
    mockResponseOnce(429, { ok: false, error: "rate_limited" });

    await submitPublicQuoteRequest(SLUG, {
      serviceKey: "home_cleaning",
      answers: { sqm: 70 },
      contact: { email: "a@b.co" },
    }).catch((err: unknown) => {
      const e = err as PublicCalculatorError;
      expect(e.rateLimited).toBe(true);
      expect(e.retryAfterSeconds).toBeNull();
      expect(e.message).toMatch(/För många förfrågningar/i);
    });
  });
});

describe("normalizePublicSubmitResponse", () => {
  it("returns null when the payload is unusable (ok !== true)", () => {
    expect(normalizePublicSubmitResponse(null)).toBeNull();
    expect(normalizePublicSubmitResponse("nope")).toBeNull();
    expect(normalizePublicSubmitResponse({ ok: false })).toBeNull();
  });

  it("coerces a partial ok payload to safe defaults instead of throwing", () => {
    const res = normalizePublicSubmitResponse({ ok: true });

    expect(res).not.toBeNull();
    expect(res?.available).toBe(false); // missing → safe-off default
    expect(res?.valid).toBe(false);
    expect(res?.issues).toEqual([]);
    expect(res?.quoteRequestLegacyId).toBeNull();
    expect(res?.reference).toBeNull();
    expect(res?.nextStep).toBeNull();
    expect(res?.selectedPlan).toBeNull();
  });

  it("keeps the stable legacy reference (non-uuid), validUntil and nextStep when present", () => {
    const res = normalizePublicSubmitResponse({
      ok: true,
      enabled: true,
      available: true,
      status: "submitted",
      valid: true,
      issues: [],
      serviceKey: "home_cleaning",
      displayText: "2 100–2 600 kr",
      calculatedPrice: 2350,
      selectedPlan: { planKey: "flexible", name: "Flexibel", hourlyRate: 349 },
      quoteRequestLegacyId: "Q-1042",
      validUntil: "2025-12-31",
      nextStep: { confirmationText: "Vi återkommer.", showLoginPrompt: false, loginPromptText: null },
    });

    expect(res?.quoteRequestLegacyId).toBe("Q-1042");
    expect(res?.validUntil).toBe("2025-12-31");
    expect(res?.nextStep?.confirmationText).toBe("Vi återkommer.");
    expect(res?.selectedPlan?.name).toBe("Flexibel");
  });

  it("strips ALL internal-only fields (including uuids) from the DTO, issues, plan and nextStep", () => {
    const res = normalizePublicSubmitResponse({
      ok: true,
      enabled: true,
      available: true,
      status: "submitted",
      valid: true,
      ...sensitiveBlob(),
      prospectId: "11111111-1111-1111-1111-111111111111",
      quoteRequestId: "22222222-2222-2222-2222-222222222222",
      issues: [{ code: "info", message: "ok", ...sensitiveBlob() }],
      serviceKey: "home_cleaning",
      displayText: "2 100–2 600 kr",
      selectedPlan: { planKey: "flexible", name: "Flexibel", hourlyRate: 349, ...sensitiveBlob() },
      nextStep: { confirmationText: "Hej", showLoginPrompt: false, loginPromptText: null, ...sensitiveBlob() },
      quoteRequestLegacyId: "Q-1042",
    });

    expect(res).not.toBeNull();
    // The DTO has EXACTLY the public keys — no uuid, no internal blob leaked in.
    expect(Object.keys(res as object).sort()).toEqual([
      "available",
      "calculatedPrice",
      "currency",
      "displayText",
      "enabled",
      "estimatedHours",
      "formulaVersion",
      "issues",
      "maxPrice",
      "minPrice",
      "nextStep",
      "ok",
      "priceAfterRut",
      "priceDisplayMode",
      "priceExclVat",
      "priceInclVat",
      "pricingModel",
      "quoteRequestLegacyId",
      "reference",
      "requiresManualReview",
      "roundingIncrement",
      "rutDeduction",
      "rutEnabled",
      "rutPercent",
      "selectedPlan",
      "serviceKey",
      "showRutBreakdown",
      "status",
      "valid",
      "validUntil",
      "vatAmount",
      "vatRatePercent",
    ]);
    expectNoSensitiveKeys(res);
    // The prospect/quote uuids never cross the wire boundary into the DTO.
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("11111111-1111-1111-1111-111111111111");
    expect(serialized).not.toContain("22222222-2222-2222-2222-222222222222");
    expect(res?.quoteRequestLegacyId).toBe("Q-1042"); // the safe, non-uuid reference is kept
  });

  it("maps the disabled (available:false) outcome and writes nothing", () => {
    const res = normalizePublicSubmitResponse({
      ok: true,
      enabled: false,
      available: false,
      status: "not_available",
      valid: false,
      issues: [{ code: "calculator_disabled", message: "Inte aktiv." }],
      displayText: "",
    });

    expect(res?.available).toBe(false);
    expect(res?.valid).toBe(false);
    expect(res?.quoteRequestLegacyId).toBeNull();
  });
});

describe("isLikelyEmail", () => {
  it("accepts well-formed addresses (trimmed)", () => {
    expect(isLikelyEmail("test@example.com")).toBe(true);
    expect(isLikelyEmail("  a.b+tag@sub.example.co  ")).toBe(true);
  });

  it("rejects empty / malformed addresses", () => {
    expect(isLikelyEmail("")).toBe(false);
    expect(isLikelyEmail("not-an-email")).toBe(false);
    expect(isLikelyEmail("missing@domain")).toBe(false);
    expect(isLikelyEmail("@no-local.com")).toBe(false);
    expect(isLikelyEmail("spaces in@email.com")).toBe(false);
  });
});
