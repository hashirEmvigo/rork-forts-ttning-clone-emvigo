import { beforeEach, describe, expect, it } from "vitest";

import {
  archiveFloorPreset,
  createFloorPreset,
  getActiveFloorPresets,
  getAllFloorPresets,
  getFloorPreset,
  reorderFloorPresets,
  unarchiveFloorPreset,
  updateFloorPreset,
} from "./floorPresetStore";
import { DEFAULT_FLOOR_PRESET_SPECS } from "@/types";

const COMPANY = "company-a";
const OTHER_COMPANY = "company-b";

beforeEach(() => {
  localStorage.clear();
});

describe("floorPresetStore — seeding", () => {
  it("lazily seeds the default presets for a company on first read", () => {
    const active = getActiveFloorPresets(COMPANY);
    expect(active).toHaveLength(DEFAULT_FLOOR_PRESET_SPECS.length);
    expect(active.map((p) => p.name)).toEqual(
      DEFAULT_FLOOR_PRESET_SPECS.map((s) => s.name),
    );
    expect(active.every((p) => p.companyId === COMPANY)).toBe(true);
  });

  it("scopes presets per company", () => {
    createFloorPreset(COMPANY, { name: "Roof Terrace" });
    expect(getAllFloorPresets(OTHER_COMPANY).some((p) => p.name === "Roof Terrace")).toBe(
      false,
    );
  });
});

describe("floorPresetStore — active vs archived reads", () => {
  it("excludes archived presets from the active list but keeps them in the all list", () => {
    const active = getActiveFloorPresets(COMPANY);
    const target = active[0];
    archiveFloorPreset(COMPANY, target.id);

    const activeAfter = getActiveFloorPresets(COMPANY);
    expect(activeAfter.some((p) => p.id === target.id)).toBe(false);

    const all = getAllFloorPresets(COMPANY);
    expect(all.some((p) => p.id === target.id && p.isArchived)).toBe(true);
  });
});

describe("floorPresetStore — create & duplicate rejection", () => {
  it("creates a preset appended after the seeded ones", () => {
    const before = getActiveFloorPresets(COMPANY).length;
    const created = createFloorPreset(COMPANY, { name: "Mezzanine" });
    expect(created).not.toBeNull();
    expect(getActiveFloorPresets(COMPANY)).toHaveLength(before + 1);
  });

  it("rejects duplicate names case-insensitively", () => {
    const existing = getActiveFloorPresets(COMPANY)[0];
    const dup = createFloorPreset(COMPANY, { name: existing.name.toUpperCase() });
    expect(dup).toBeNull();
  });

  it("rejects empty/whitespace names", () => {
    expect(createFloorPreset(COMPANY, { name: "   " })).toBeNull();
  });

  it("rejects renaming onto another preset's name", () => {
    const presets = getActiveFloorPresets(COMPANY);
    const updated = updateFloorPreset(COMPANY, presets[1].id, {
      name: presets[0].name,
    });
    expect(updated).toBeNull();
  });
});

describe("floorPresetStore — deterministic sorting", () => {
  it("orders by sortOrder regardless of insertion order", () => {
    const presets = getActiveFloorPresets(COMPANY);
    const orders = presets.map((p) => p.sortOrder);
    const sorted = [...orders].sort((a, b) => a - b);
    expect(orders).toEqual(sorted);
  });
});

describe("floorPresetStore — reorder", () => {
  it("rewrites sortOrder to match the provided id order", () => {
    const presets = getActiveFloorPresets(COMPANY);
    const reversedIds = [...presets].reverse().map((p) => p.id);
    reorderFloorPresets(COMPANY, reversedIds);

    const after = getActiveFloorPresets(COMPANY);
    expect(after.map((p) => p.id)).toEqual(reversedIds);
  });
});

describe("floorPresetStore — archive & restore", () => {
  it("archives then restores a preset back into the active list", () => {
    const target = getActiveFloorPresets(COMPANY)[0];

    archiveFloorPreset(COMPANY, target.id);
    expect(getFloorPreset(COMPANY, target.id)?.isArchived).toBe(true);

    unarchiveFloorPreset(COMPANY, target.id);
    expect(getFloorPreset(COMPANY, target.id)?.isArchived).toBe(false);
    expect(getActiveFloorPresets(COMPANY).some((p) => p.id === target.id)).toBe(true);
  });
});
