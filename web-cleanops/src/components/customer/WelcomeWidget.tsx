import { Sparkles } from "lucide-react";

interface WelcomeWidgetProps {
  name: string;
  companyName: string;
  /** Pill label shown above the greeting. Defaults to the customer portal. */
  portalLabel?: string;
  /** Sub-heading copy. Defaults to the customer portal message. */
  description?: string;
}

/**
 * Hero greeting widget, reused across the customer and employee portals. A
 * self-contained widget so the dashboard can reorder or drop it without touching
 * other areas.
 */
export function WelcomeWidget({
  name,
  companyName,
  portalLabel = "Customer portal",
  description,
}: WelcomeWidgetProps) {
  const firstName = name.split(" ")[0];
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-6 sm:p-8">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <Sparkles className="h-3.5 w-3.5" /> {portalLabel}
        </span>
        <h1 className="mt-4 font-display text-2xl tracking-tight sm:text-3xl">
          Good {part}, {firstName}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          {description ??
            `Welcome to your portal with ${companyName}. Everything shared with you lives here.`}
        </p>
      </div>
    </section>
  );
}
