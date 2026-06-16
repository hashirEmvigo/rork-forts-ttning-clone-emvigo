/**
 * REQUEST CRM — mock data notice (Slice 0).
 *
 * A prominent, reusable banner that makes the shell's nature unmistakable: this
 * is a frontend-only preview with read-only mock data. No writes, no backend, no
 * live automation or AI. Display only.
 */
import { FlaskConical } from "lucide-react";

import { cn } from "@/lib/utils";

interface MockDataNoticeProps {
  className?: string;
}

export function MockDataNotice({ className }: MockDataNoticeProps) {
  return (
    <div
      data-testid="crm-mock-data-notice"
      className={cn(
        "flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3.5 text-amber-900",
        className,
      )}
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
        <FlaskConical className="h-4 w-4" />
      </div>
      <div className="text-sm leading-relaxed">
        <p className="font-semibold">Slice 0 — frontend shell with mock data</p>
        <p className="mt-0.5 text-amber-800">
          Everything here is read-only demo data. No settings are saved, no requests are created,
          and no automation, AI, notifications or runtime guards run. Controls are intentionally
          disabled placeholders.
        </p>
      </div>
    </div>
  );
}
