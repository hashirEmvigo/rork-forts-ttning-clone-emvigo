import type { TimeCode, TimeCodeType } from "@/types";

/**
 * Time Codes — payroll-foundation persistence layer.
 *
 * Like {@link checklistCategoryStore.ts} and {@link floorPresetStore.ts}, this
 * is a backend-shaped abstraction over localStorage so it can be swapped for a
 * Supabase table (see migration `0011_time_codes.sql`) without touching
 * callers. The store owns persistence, normalization and one-time seeding of the
 * Super Admin master library; CRUD authorization and audit logging live in the
 * AppContext (consistent with Services).
 *
 * Invariants:
 *  - Global master codes have `companyId === null`; company-specific codes
 *    (future) carry a non-null `companyId`. The shape supports both today.
 *  - `code` is unique within a (companyId, code) pair (case-insensitive).
 *  - System-managed codes are seeded once and can be deactivated but never
 *    deleted.
 */

const TIME_CODES_KEY = "cleanops.timeCodes";

/** The seeded global master library, mirroring the agreed payroll codes. */
const MASTER_LIBRARY_SPECS: ReadonlyArray<{
  code: string;
  name: string;
  type: TimeCodeType;
  description: string;
}> = [
  { code: "10", name: "Worked Time", type: "attendance", description: "Standard worked time." },
  { code: "385", name: "Travel Time", type: "attendance", description: "Compensated travel time." },
  { code: "355", name: "Vacation", type: "absence", description: "Paid vacation leave." },
  { code: "360", name: "Sick Leave", type: "absence", description: "Sick-leave absence." },
  { code: "374", name: "VAB / Child Care Leave", type: "absence", description: "Care of a sick child (VAB)." },
  { code: "380", name: "Parental Leave", type: "absence", description: "Parental leave absence." },
];

function readTimeCodes(): TimeCode[] {
  try {
    const raw = localStorage.getItem(TIME_CODES_KEY);
    return raw ? (JSON.parse(raw) as TimeCode[]) : [];
  } catch {
    return [];
  }
}

function writeTimeCodes(codes: TimeCode[]): void {
  try {
    localStorage.setItem(TIME_CODES_KEY, JSON.stringify(codes));
  } catch (err) {
    console.error("Failed to persist time codes", err);
  }
}

/**
 * Builds the seeded global master library with STABLE ids and timestamps.
 *
 * The id is derived from the code (`tc_master_<code>`) so the localStorage seed
 * (the flag-off backout copy) is byte-identical to the Supabase seed in migration
 * `0052_time_codes_live_schema_align_and_seed.sql`. This keeps the cut-over shadow
 * comparison drift-free and means a code resolves to the same id whether read from
 * Supabase (authoritative) or the local rollback copy. User-created codes still get
 * a random id via `makeId("tc")` in the AppContext.
 */
export function defaultTimeCodes(): TimeCode[] {
  const now = new Date().toISOString();
  return MASTER_LIBRARY_SPECS.map((spec) => ({
    id: `tc_master_${spec.code}`,
    companyId: null,
    code: spec.code,
    name: spec.name,
    type: spec.type,
    description: spec.description,
    active: true,
    systemManaged: true,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Lazily seeds the global master library the first time the store is read with
 * no global codes present, so existing workspaces gain the library without a
 * migration step. Company-specific codes (future) are never seeded.
 */
function ensureSeeded(): TimeCode[] {
  const all = readTimeCodes();
  const hasGlobal = all.some((c) => c.companyId === null);
  if (hasGlobal) return all;
  const seeded = [...all, ...defaultTimeCodes()];
  writeTimeCodes(seeded);
  return seeded;
}

/** Returns every time code (global + company), seeding the master library on first use. */
export function getTimeCodes(): TimeCode[] {
  return ensureSeeded();
}

/** Persists the full time-code list. */
export function saveTimeCodes(codes: TimeCode[]): void {
  writeTimeCodes(codes);
}

/** Normalizes a code value for case-insensitive uniqueness checks. */
export function normalizeTimeCode(code: string | undefined | null): string {
  return (code ?? "").trim().toLowerCase();
}
