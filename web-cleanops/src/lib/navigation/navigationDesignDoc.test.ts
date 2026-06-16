import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards the Navigation & Menu Design Standard document (Slice 11A). The design
 * doc is a deliverable in its own right, so these assertions keep its required
 * sections from silently disappearing.
 */
const here = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = resolve(here, "../../../docs/design/navigation-and-menu-design-standard.md");

function readDoc(): string {
  return readFileSync(DOC_PATH, "utf8");
}

describe("navigation & menu design standard document", () => {
  it("exists and is non-trivial", () => {
    const doc = readDoc();
    expect(doc.length).toBeGreaterThan(500);
    expect(doc).toMatch(/Navigation & Menu Design Standard/i);
  });

  it("documents the menu/tile design rules", () => {
    const doc = readDoc().toLowerCase();
    expect(doc).toContain("icon above");
    expect(doc).toContain("equal tile");
    expect(doc).toContain("two-line");
    expect(doc).toContain("tooltip");
  });

  it("documents responsive grid + card-vs-table rules", () => {
    const doc = readDoc().toLowerCase();
    expect(doc).toContain("responsive grid");
    expect(doc).toContain("card vs table");
  });

  it("documents the navigation registry structure and translation readiness", () => {
    const doc = readDoc();
    expect(doc).toMatch(/translation readiness/i);
    expect(doc).toContain("translation_key");
    expect(doc).toContain("menu_key");
    // Future language targets are named so the registry stays translation-ready.
    expect(doc).toMatch(/sv-SE/);
    expect(doc).toMatch(/en-US/);
  });

  it("states that the permission system remains authoritative (security rule)", () => {
    const doc = readDoc();
    expect(doc).toMatch(/permission system remains authoritative/i);
    expect(doc).toMatch(/presentation only/i);
    // route + permission key must be documented as non-editable.
    expect(doc).toContain("is **not** editable");
  });
});
