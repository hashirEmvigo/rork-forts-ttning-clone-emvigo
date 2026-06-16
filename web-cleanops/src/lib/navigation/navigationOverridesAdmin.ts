/**
 * Navigation & Menu Registry — override repository (Slice 11A).
 *
 * Supabase-authoritative reads/writes for the CUSTOMIZATION layer
 * (`navigation_menu_overrides`, migration 0062). The stable technical registry
 * lives in source (navigationRegistry.ts) and is never written here — only the
 * safe presentation fields (custom label / custom icon / sort order /
 * visibility) are persisted, scoped to the system level for the MVP.
 *
 * SAFETY
 *   • Reads/writes go through the AUTHENTICATED Supabase client, so the table's
 *     super_admin-only RLS gates access (no anon path, no localStorage truth).
 *   • Reads are RESILIENT to a not-yet-applied migration: a missing table
 *     returns an empty override set so the registry defaults still render and
 *     nothing crashes. Writes against a missing table surface a clear error.
 *   • custom_icon is validated against the controlled icon set; an unknown icon
 *     is dropped (never persisted) so a menu can never reference a bad icon.
 *   • "Reset to default" NEUTRALISES the row (NULLs + visible) — never a delete.
 */
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { isNavigationIconKey } from "./iconRegistry";
import type { NavigationMenuOverride } from "./navigationRegistry";

/** Max length for a custom menu label (tile menus need short labels). */
export const MAX_CUSTOM_LABEL_LENGTH = 40;

class NavigationOverridesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NavigationOverridesError";
  }
}

function configuredClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new NavigationOverridesError(
      "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return supabase;
}

const OVERRIDE_COLUMNS = "menu_key, custom_label, custom_icon, sort_order, is_visible";

interface OverrideRow {
  menu_key: string;
  custom_label: string | null;
  custom_icon: string | null;
  sort_order: number | null;
  is_visible: boolean | null;
}

/** Maps a DB row to the app-facing override view (defensive about types). */
export function mapOverrideRow(row: OverrideRow): NavigationMenuOverride {
  return {
    menuKey: row.menu_key,
    customLabel: typeof row.custom_label === "string" && row.custom_label.trim() !== "" ? row.custom_label : null,
    customIcon: isNavigationIconKey(row.custom_icon) ? row.custom_icon : null,
    sortOrder: typeof row.sort_order === "number" && Number.isFinite(row.sort_order) ? row.sort_order : null,
    isVisible: row.is_visible !== false,
  };
}

/** True when a Supabase/Postgres error means the table has not been created yet. */
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true; // undefined_table
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("could not find the table") || msg.includes("schema cache");
}

/**
 * Loads all system-scope menu overrides. Returns an empty array (not an error)
 * when the table does not exist yet, so the registry defaults render cleanly
 * before migration 0062 is applied.
 */
export async function listNavigationMenuOverrides(): Promise<NavigationMenuOverride[]> {
  const client = configuredClient();
  const { data, error } = await client
    .from("navigation_menu_overrides")
    .select(OVERRIDE_COLUMNS)
    .is("company_id", null);

  if (error) {
    if (isMissingTableError(error)) return [];
    throw new NavigationOverridesError(`[navigation_menu_overrides] read failed: ${error.message}`);
  }
  return ((data ?? []) as OverrideRow[]).map(mapOverrideRow);
}

// ── Validation (pure, exported) ──────────────────────────────────────────────

export interface OverrideDraft {
  menuKey: string;
  customLabel: string | null;
  customIcon: string | null;
  sortOrder: number | null;
  isVisible: boolean;
}

/**
 * Validates a presentation override draft. Returns human-readable problems
 * ([] when valid). Only presentation fields are validated — technical fields
 * are never part of the draft.
 */
export function validateOverrideDraft(draft: OverrideDraft): string[] {
  const errors: string[] = [];

  if (draft.menuKey.trim() === "") errors.push("A menu key is required.");

  if (draft.customLabel !== null) {
    if (draft.customLabel.trim() === "") {
      errors.push("Custom label cannot be only whitespace (clear it to use the default).");
    } else if (draft.customLabel.trim().length > MAX_CUSTOM_LABEL_LENGTH) {
      errors.push(`Custom label must be ${MAX_CUSTOM_LABEL_LENGTH} characters or fewer.`);
    }
  }

  if (draft.customIcon !== null && !isNavigationIconKey(draft.customIcon)) {
    errors.push("Choose an icon from the allowed set.");
  }

  if (draft.sortOrder !== null && (!Number.isFinite(draft.sortOrder) || !Number.isInteger(draft.sortOrder))) {
    errors.push("Sort order must be a whole number.");
  }

  return errors;
}

/** Normalises a draft into the row payload (trims label, drops bad icon). */
function draftToPayload(draft: OverrideDraft): Record<string, unknown> {
  const label = draft.customLabel !== null && draft.customLabel.trim() !== "" ? draft.customLabel.trim() : null;
  const icon = isNavigationIconKey(draft.customIcon) ? draft.customIcon : null;
  const sortOrder = draft.sortOrder !== null && Number.isFinite(draft.sortOrder) ? Math.trunc(draft.sortOrder) : null;
  return {
    menu_key: draft.menuKey,
    custom_label: label,
    custom_icon: icon,
    sort_order: sortOrder,
    is_visible: draft.isVisible,
    scope_type: "system",
    company_id: null,
    company_legacy_id: null,
  };
}

/**
 * Upserts ONE system-scope override (matched on the stable menu_key). Writes
 * only presentation fields. Throws on validation failure or DB error.
 */
export async function upsertNavigationMenuOverride(draft: OverrideDraft): Promise<void> {
  const problems = validateOverrideDraft(draft);
  if (problems.length > 0) {
    throw new NavigationOverridesError(problems.join(" "));
  }
  const client = configuredClient();
  const { error } = await client
    .from("navigation_menu_overrides")
    .upsert(draftToPayload(draft), { onConflict: "menu_key" });

  if (error) {
    if (isMissingTableError(error)) {
      throw new NavigationOverridesError(
        "The navigation overrides table is not available yet. Apply migration 0062 before saving.",
      );
    }
    throw new NavigationOverridesError(`[navigation_menu_overrides] save failed: ${error.message}`);
  }
}

/**
 * Resets one menu item to its registry defaults by NEUTRALISING the override
 * row (NULL label/icon/order + visible). Never a hard delete.
 */
export async function resetNavigationMenuOverride(menuKey: string): Promise<void> {
  await upsertNavigationMenuOverride({
    menuKey,
    customLabel: null,
    customIcon: null,
    sortOrder: null,
    isVisible: true,
  });
}
