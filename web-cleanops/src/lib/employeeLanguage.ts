import type { EmployeeLanguage } from "@/types";

/**
 * Employee Language — controlled, company-scoped language helpers.
 *
 * Employee-facing fields (preferred language and, later, multilingual
 * checklists/notifications) must reference a structured {@link EmployeeLanguage}
 * by id/code rather than free text like "Polish" / "polski" / "POLISH". These
 * pure helpers normalize codes for matching, filter active languages, resolve
 * the company default, and enforce the single-default invariant. Everything
 * here is deterministic and side-effect free so it can be reused across
 * UI/store and unit-tested in isolation.
 */

/** Shape of a seeded default language (no ids/timestamps — those are assigned at seed time). */
export interface DefaultEmployeeLanguageSeed {
  code: string;
  name: string;
  nativeName: string;
  isActive: boolean;
  isDefault: boolean;
}

/**
 * Default languages seeded for every company on first launch. English and
 * Swedish are active out of the box (English is the default); the rest are
 * available but inactive until an admin turns them on.
 */
export const DEFAULT_EMPLOYEE_LANGUAGES: readonly DefaultEmployeeLanguageSeed[] = [
  { code: "en", name: "English", nativeName: "English", isActive: true, isDefault: true },
  { code: "sv", name: "Swedish", nativeName: "Svenska", isActive: true, isDefault: false },
  { code: "pl", name: "Polish", nativeName: "Polski", isActive: false, isDefault: false },
  { code: "uk", name: "Ukrainian", nativeName: "Українська", isActive: false, isDefault: false },
  { code: "es", name: "Spanish", nativeName: "Español", isActive: false, isDefault: false },
  { code: "de", name: "German", nativeName: "Deutsch", isActive: false, isDefault: false },
];

/** Normalizes a language code for case-insensitive, whitespace-tolerant matching. */
export function normalizeLanguageCode(code: string | undefined | null): string {
  return (code ?? "").trim().toLowerCase();
}

/** Returns only the active languages, preserving input order. */
export function listActiveEmployeeLanguages(
  languages: readonly EmployeeLanguage[],
): EmployeeLanguage[] {
  return languages.filter((l) => l.isActive);
}

/**
 * Resolves the company default language: the active language flagged default,
 * falling back to the first active language, else undefined. Never returns an
 * inactive language so callers can rely on the result being assignable.
 */
export function getDefaultEmployeeLanguage(
  languages: readonly EmployeeLanguage[],
): EmployeeLanguage | undefined {
  const active = listActiveEmployeeLanguages(languages);
  return active.find((l) => l.isDefault) ?? active[0];
}

/**
 * Resolves an employee's effective preferred language. Priority:
 *   1. the explicitly assigned language (returned even if it has since been
 *      deactivated, so callers can surface it as inactive rather than erase it),
 *   2. the company default ({@link getDefaultEmployeeLanguage}).
 * Returns undefined only when the company has no languages at all. Pure and
 * side-effect free; pass a company-scoped list.
 */
export function resolveEmployeeLanguage(
  languageId: string | undefined | null,
  languages: readonly EmployeeLanguage[],
): EmployeeLanguage | undefined {
  if (languageId) {
    const assigned = languages.find((l) => l.id === languageId);
    if (assigned) return assigned;
  }
  return getDefaultEmployeeLanguage(languages);
}

/** Whether a language can be assigned to employees (must be active). */
export function isLanguageAssignable(
  language: EmployeeLanguage | undefined | null,
): boolean {
  return Boolean(language?.isActive);
}

/**
 * Returns a normalized copy of the languages where at most one is flagged
 * default and the default is always active. If multiple defaults exist, the
 * first active default wins; if the flagged default is inactive (or none is
 * flagged), the first active language is promoted. Idempotent and side-effect
 * free. Operates on whatever list it's given — scope to a company before
 * calling when needed.
 */
export function normalizeEmployeeLanguages(
  languages: readonly EmployeeLanguage[],
): EmployeeLanguage[] {
  const active = listActiveEmployeeLanguages(languages);
  if (active.length === 0) {
    // No active language can hold the default flag — clear any stale ones.
    return languages.map((l) => (l.isDefault ? { ...l, isDefault: false } : l));
  }
  const flaggedActive = active.find((l) => l.isDefault);
  const winnerId = (flaggedActive ?? active[0]).id;
  return languages.map((l) => {
    const shouldBeDefault = l.id === winnerId;
    return l.isDefault === shouldBeDefault ? l : { ...l, isDefault: shouldBeDefault };
  });
}

/**
 * Returns a copy of the languages with the given id set as the sole default.
 * The target must be active and present; otherwise the list is returned
 * normalized but unchanged in intent (no new default is forced onto an inactive
 * language). Pure and side-effect free.
 */
export function setDefaultEmployeeLanguage(
  languages: readonly EmployeeLanguage[],
  id: string,
): EmployeeLanguage[] {
  const target = languages.find((l) => l.id === id);
  if (!target || !target.isActive) {
    return normalizeEmployeeLanguages(languages);
  }
  const withDefault = languages.map((l) => {
    const shouldBeDefault = l.id === id;
    return l.isDefault === shouldBeDefault ? l : { ...l, isDefault: shouldBeDefault };
  });
  return normalizeEmployeeLanguages(withDefault);
}
