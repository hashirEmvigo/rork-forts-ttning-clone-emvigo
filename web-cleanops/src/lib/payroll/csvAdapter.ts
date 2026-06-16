import {
  baseValidate,
  partitionIssues,
  type PayrollExportAdapter,
  type PayrollExportContext,
  type PayrollExportIssue,
  type PayrollExportResult,
} from "./adapter";

/**
 * CSV reference adapter — the one working adapter in the foundation phase.
 *
 * It exists to prove the adapter contract end-to-end and to give tests a real
 * transform, NOT as a production payroll integration. It emits a deterministic,
 * RFC-4180-escaped CSV resolving each row's time code by id. The column
 * delimiter can be overridden via `profile.config.delimiter`.
 */

const DEFAULT_DELIMITER = ",";

const COLUMNS = [
  "date",
  "employee_id",
  "employee_name",
  "time_code",
  "time_code_name",
  "time_code_type",
  "quantity",
  "unit",
] as const;

/** Escapes a CSV field per RFC 4180 when it contains the delimiter, quotes or newlines. */
function escapeField(value: string, delimiter: string): string {
  if (value.includes(delimiter) || value.includes('"') || /[\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export const csvAdapter: PayrollExportAdapter = {
  target: "csv",
  label: "CSV",
  implemented: true,

  validate(ctx: PayrollExportContext): PayrollExportIssue[] {
    const issues = baseValidate({ target: "csv" }, ctx);
    const delimiter = ctx.profile.config.delimiter;
    if (delimiter !== undefined && typeof delimiter !== "string") {
      issues.push({ level: "error", message: "CSV delimiter must be a string." });
    }
    return issues;
  },

  transform(ctx: PayrollExportContext): PayrollExportResult {
    const issues = this.validate(ctx);
    const { errors, warnings } = partitionIssues(issues);
    if (errors.length > 0) {
      return { ok: false, rowsIncluded: 0, warnings, errors, output: { kind: "none" } };
    }

    const delimiter =
      typeof ctx.profile.config.delimiter === "string"
        ? ctx.profile.config.delimiter
        : DEFAULT_DELIMITER;

    const header = COLUMNS.join(delimiter);
    const lines = ctx.basis.rows.map((row) => {
      const code = ctx.timeCodes.get(row.timeCodeId);
      const fields = [
        row.date,
        row.employeeId,
        row.employeeName,
        code?.code ?? row.timeCodeId,
        code?.name ?? "",
        code?.type ?? "",
        String(row.quantity),
        row.unit,
      ];
      return fields.map((f) => escapeField(f, delimiter)).join(delimiter);
    });

    const content = [header, ...lines].join("\r\n");
    const filename = `payroll-${ctx.basis.companyId}-${ctx.basis.periodStart}_${ctx.basis.periodEnd}.csv`;

    return {
      ok: true,
      rowsIncluded: ctx.basis.rows.length,
      warnings,
      errors: [],
      output: { kind: "file", filename, mimeType: "text/csv", content },
    };
  },
};
