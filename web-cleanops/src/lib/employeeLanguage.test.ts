import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_EMPLOYEE_LANGUAGES,
  getDefaultEmployeeLanguage,
  isLanguageAssignable,
  listActiveEmployeeLanguages,
  normalizeEmployeeLanguages,
  normalizeLanguageCode,
  resolveEmployeeLanguage,
  setDefaultEmployeeLanguage,
} from "./employeeLanguage";
import {
  archiveEmployeeLanguage,
  createEmployeeLanguage,
  getActiveEmployeeLanguages,
  getEmployeeLanguages,
  listEmployeeLanguages,
  restoreEmployeeLanguage,
  setEmployeeLanguageDefault,
  updateEmployeeLanguage,
} from "./store";
import type { EmployeeLanguage } from "@/types";

const COMPANY = "cmp_nordlys";

beforeEach(() => {
  localStorage.clear();
});

function makeLanguage(over: Partial<EmployeeLanguage> = {}): EmployeeLanguage {
  const now = new Date().toISOString();
  return {
    id: "lang_1",
    companyId: COMPANY,
    code: "en",
    name: "English",
    nativeName: "English",
    isActive: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe("employeeLanguage — pure helpers", () => {
  it("normalizes language codes for matching", () => {
    expect(normalizeLanguageCode("  EN ")).toBe("en");
    expect(normalizeLanguageCode(undefined)).toBe("");
  });

  it("filters active languages", () => {
    const list = [makeLanguage(), makeLanguage({ id: "lang_2", isActive: false })];
    expect(listActiveEmployeeLanguages(list).map((l) => l.id)).toEqual(["lang_1"]);
  });

  it("resolves the active default, falling back to the first active", () => {
    const flagged = [
      makeLanguage({ id: "a", isDefault: false }),
      makeLanguage({ id: "b", isDefault: true }),
    ];
    expect(getDefaultEmployeeLanguage(flagged)?.id).toBe("b");

    const noFlag = [
      makeLanguage({ id: "a", isDefault: false }),
      makeLanguage({ id: "b", isDefault: false }),
    ];
    expect(getDefaultEmployeeLanguage(noFlag)?.id).toBe("a");

    expect(getDefaultEmployeeLanguage([])).toBeUndefined();
  });

  it("only treats active languages as assignable", () => {
    expect(isLanguageAssignable(makeLanguage())).toBe(true);
    expect(isLanguageAssignable(makeLanguage({ isActive: false }))).toBe(false);
    expect(isLanguageAssignable(null)).toBe(false);
  });

  it("normalizes to a single active default and clears defaults when none active", () => {
    const many = normalizeEmployeeLanguages([
      makeLanguage({ id: "a", isDefault: true }),
      makeLanguage({ id: "b", isDefault: true }),
    ]);
    expect(many.filter((l) => l.isDefault).map((l) => l.id)).toEqual(["a"]);

    const inactiveDefault = normalizeEmployeeLanguages([
      makeLanguage({ id: "a", isActive: false, isDefault: true }),
      makeLanguage({ id: "b", isActive: true, isDefault: false }),
    ]);
    expect(inactiveDefault.find((l) => l.isDefault)?.id).toBe("b");

    const noneActive = normalizeEmployeeLanguages([
      makeLanguage({ id: "a", isActive: false, isDefault: true }),
    ]);
    expect(noneActive.some((l) => l.isDefault)).toBe(false);
  });

  it("resolves an employee's preferred language with default fallback", () => {
    const list = [
      makeLanguage({ id: "en", isDefault: true }),
      makeLanguage({ id: "sv", code: "sv", name: "Swedish", isDefault: false }),
      makeLanguage({ id: "pl", code: "pl", name: "Polish", isActive: false, isDefault: false }),
    ];
    // Explicit, active assignment wins.
    expect(resolveEmployeeLanguage("sv", list)?.id).toBe("sv");
    // No assignment falls back to the company default.
    expect(resolveEmployeeLanguage(undefined, list)?.id).toBe("en");
    expect(resolveEmployeeLanguage(null, list)?.id).toBe("en");
    // An assigned-but-inactive language is preserved, not erased.
    expect(resolveEmployeeLanguage("pl", list)?.id).toBe("pl");
    // Unknown id falls back to default.
    expect(resolveEmployeeLanguage("missing", list)?.id).toBe("en");
    // No languages at all → undefined.
    expect(resolveEmployeeLanguage("sv", [])).toBeUndefined();
  });

  it("sets the sole default only for an active target", () => {
    const list = [
      makeLanguage({ id: "a", isDefault: true }),
      makeLanguage({ id: "b", isDefault: false }),
      makeLanguage({ id: "c", isActive: false, isDefault: false }),
    ];
    const next = setDefaultEmployeeLanguage(list, "b");
    expect(next.filter((l) => l.isDefault).map((l) => l.id)).toEqual(["b"]);

    // Inactive target keeps the existing valid default.
    const blocked = setDefaultEmployeeLanguage(list, "c");
    expect(blocked.find((l) => l.isDefault)?.id).toBe("a");
  });
});

describe("employeeLanguage store — seeding", () => {
  it("seeds the default language list for every company", () => {
    const langs = listEmployeeLanguages(COMPANY);
    for (const seed of DEFAULT_EMPLOYEE_LANGUAGES) {
      expect(langs.some((l) => l.code === seed.code)).toBe(true);
    }
  });

  it("seeds English and Swedish active, the rest inactive, with English default", () => {
    const langs = listEmployeeLanguages(COMPANY);
    const active = getActiveEmployeeLanguages(COMPANY).map((l) => l.code).sort();
    expect(active).toEqual(["en", "sv"]);
    expect(langs.find((l) => l.code === "pl")?.isActive).toBe(false);
    expect(getDefaultEmployeeLanguage(langs)?.code).toBe("en");
    expect(langs.filter((l) => l.isDefault).length).toBe(1);
  });

  it("does not duplicate languages on repeated loads", () => {
    const first = getEmployeeLanguages().length;
    // Reading again re-runs the idempotent seed guard.
    const second = getEmployeeLanguages().length;
    expect(second).toBe(first);
  });
});

describe("employeeLanguage store — CRUD", () => {
  it("creates, lists and rejects duplicate codes", () => {
    const created = createEmployeeLanguage({ companyId: COMPANY, code: "no", name: "Norwegian" });
    expect(created).not.toBeNull();
    expect(created?.isActive).toBe(true);
    expect(created?.isDefault).toBe(false);
    expect(created?.nativeName).toBe("Norwegian");

    expect(createEmployeeLanguage({ companyId: COMPANY, code: "NO", name: "Dup" })).toBeNull();
    expect(createEmployeeLanguage({ companyId: COMPANY, code: " ", name: "x" })).toBeNull();
    expect(createEmployeeLanguage({ companyId: COMPANY, code: "fr", name: " " })).toBeNull();
  });

  it("updates metadata and rejects clashing code renames", () => {
    const a = createEmployeeLanguage({ companyId: COMPANY, code: "no", name: "Norwegian" });
    expect(updateEmployeeLanguage(a!.id, { nativeName: "Norsk" })?.nativeName).toBe("Norsk");
    // "en" already exists from seeding.
    expect(updateEmployeeLanguage(a!.id, { code: "en" })).toBeNull();
  });
});

describe("employeeLanguage store — default & activation", () => {
  it("sets a new default and clears the previous one", () => {
    const sv = listEmployeeLanguages(COMPANY).find((l) => l.code === "sv");
    setEmployeeLanguageDefault(sv!.id);
    const langs = listEmployeeLanguages(COMPANY);
    expect(langs.filter((l) => l.isDefault).map((l) => l.code)).toEqual(["sv"]);
  });

  it("refuses to make an inactive language the default", () => {
    const pl = listEmployeeLanguages(COMPANY).find((l) => l.code === "pl");
    expect(setEmployeeLanguageDefault(pl!.id)).toBeNull();
  });

  it("promotes another active language when the default is deactivated", () => {
    const en = listEmployeeLanguages(COMPANY).find((l) => l.code === "en");
    expect(en?.isDefault).toBe(true);
    archiveEmployeeLanguage(en!.id);
    const langs = listEmployeeLanguages(COMPANY);
    const newDefault = getDefaultEmployeeLanguage(langs);
    expect(newDefault?.isActive).toBe(true);
    expect(newDefault?.code).toBe("sv");
    expect(langs.find((l) => l.code === "en")?.isDefault).toBe(false);
  });

  it("activates and deactivates languages, affecting active lists only", () => {
    const pl = listEmployeeLanguages(COMPANY).find((l) => l.code === "pl");
    restoreEmployeeLanguage(pl!.id);
    expect(getActiveEmployeeLanguages(COMPANY).some((l) => l.code === "pl")).toBe(true);
    archiveEmployeeLanguage(pl!.id);
    expect(getActiveEmployeeLanguages(COMPANY).some((l) => l.code === "pl")).toBe(false);
    expect(listEmployeeLanguages(COMPANY).some((l) => l.code === "pl")).toBe(true);
  });
});
