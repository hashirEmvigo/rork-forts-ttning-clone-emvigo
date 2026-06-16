import type {
  PayrollBasis,
  PayrollExportProfile,
  PayrollExportTargetKey,
  TimeCode,
} from "@/types";

/**
 * Payroll Export — adapter contract (architecture foundation).
 *
 * The payroll layer is ADAPTER-BASED from the start: payroll calculation and the
 * internal {@link PayrollBasis} never depend on an export target. Each export
 * destination is implemented as one {@link PayrollExportAdapter} that:
 *   1. validates the basis + profile have everything it needs, and
 *   2. transforms the internal rows into the target format, returning a result.
 *
 * Real integrations (Fortnox/PAXml/Visma/Hogia/API/SFTP/Webhook) are NOT built in
 * this phase. They are registered as `NotImplementedAdapter` stubs so the
 * registry, entitlements and UI are complete and future adapters drop in without
 * touching the basis. A working CSV reference adapter exists for testing.
 *
 * Everything here is pure and side-effect free (no network/file IO) so adapters
 * are trivially unit-tested and safe to call from the resolver/UI.
 */

/** The immutable inputs an adapter operates on. Pure data; no IO. */
export interface PayrollExportContext {
  profile: PayrollExportProfile;
  basis: PayrollBasis;
  /** O(1) time-code resolution by id, so adapters never scan a list. */
  timeCodes: ReadonlyMap<string, TimeCode>;
  /** The instant the export is performed against. */
  now: Date;
}

/** Severity of an issue raised during validation or transform. */
export type PayrollExportIssueLevel = "error" | "warning";

/** A single validation/transform finding, optionally tied to a basis row. */
export interface PayrollExportIssue {
  level: PayrollExportIssueLevel;
  message: string;
  /** The offending basis row id, when row-specific. */
  rowId?: string;
}

/**
 * The artifact an adapter produced. File adapters return inline content (a data
 * string + mime/filename) the caller can offer as a download; integration
 * adapters return an opaque reference to a remote result. `none` is used when a
 * stub adapter cannot produce output yet.
 */
export type PayrollExportOutput =
  | { kind: "file"; filename: string; mimeType: string; content: string }
  | { kind: "reference"; reference: string }
  | { kind: "none" };

/** The result of running an adapter's transform step. */
export interface PayrollExportResult {
  ok: boolean;
  rowsIncluded: number;
  warnings: string[];
  errors: string[];
  output: PayrollExportOutput;
}

/**
 * One export destination. Implementations MUST be pure: `validate` and
 * `transform` derive their result solely from the {@link PayrollExportContext}.
 */
export interface PayrollExportAdapter {
  target: PayrollExportTargetKey;
  label: string;
  /** True once a real implementation exists (false for stubs). */
  implemented: boolean;
  /** Returns blocking errors + non-blocking warnings for the given context. */
  validate(ctx: PayrollExportContext): PayrollExportIssue[];
  /** Transforms the basis into the target format. Never throws. */
  transform(ctx: PayrollExportContext): PayrollExportResult;
}

/** Splits issues into error/warning message lists for a result. */
export function partitionIssues(issues: PayrollExportIssue[]): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const issue of issues) {
    if (issue.level === "error") errors.push(issue.message);
    else warnings.push(issue.message);
  }
  return { errors, warnings };
}

/**
 * Shared baseline validation every adapter can reuse: the profile must be active
 * and its target must match the adapter; the basis must be approved and contain
 * rows whose time codes all resolve. Returned issues are adapter-agnostic.
 */
export function baseValidate(
  adapter: Pick<PayrollExportAdapter, "target">,
  ctx: PayrollExportContext,
): PayrollExportIssue[] {
  const issues: PayrollExportIssue[] = [];
  if (!ctx.profile.active) {
    issues.push({ level: "error", message: "Export profile is inactive." });
  }
  if (ctx.profile.target !== adapter.target) {
    issues.push({
      level: "error",
      message: `Profile target “${ctx.profile.target}” does not match adapter “${adapter.target}”.`,
    });
  }
  if (ctx.basis.status !== "approved") {
    issues.push({
      level: "error",
      message: "Only an approved payroll basis can be exported.",
    });
  }
  if (ctx.basis.rows.length === 0) {
    issues.push({ level: "warning", message: "Payroll basis has no rows." });
  }
  for (const row of ctx.basis.rows) {
    if (!ctx.timeCodes.has(row.timeCodeId)) {
      issues.push({
        level: "error",
        message: `Row references unknown time code “${row.timeCodeId}”.`,
        rowId: row.id,
      });
    }
  }
  return issues;
}

/**
 * Builds a stub adapter for a target that has no real implementation yet. It
 * validates with the shared baseline (so configuration UX is realistic) but its
 * transform always fails with a clear "not implemented" error and produces no
 * output. This keeps the architecture complete without faking integrations.
 */
export function createNotImplementedAdapter(
  target: PayrollExportTargetKey,
  label: string,
): PayrollExportAdapter {
  return {
    target,
    label,
    implemented: false,
    validate: (ctx) => baseValidate({ target }, ctx),
    transform: () => ({
      ok: false,
      rowsIncluded: 0,
      warnings: [],
      errors: [`The ${label} export adapter is not implemented yet.`],
      output: { kind: "none" },
    }),
  };
}
