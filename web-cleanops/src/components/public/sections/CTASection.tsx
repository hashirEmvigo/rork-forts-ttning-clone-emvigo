import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CtaSectionConfig, PublicCta } from "@/lib/publicSite/types";

/** A prominent closing call-to-action on a brand-navy panel with grain. */
export function CTASection({ section }: { section: CtaSectionConfig }) {
  const { heading, subheading, primaryCta, secondaryCta } = section;

  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-sidebar px-6 py-16 text-center shadow-xl sm:px-12">
          <div className="grain absolute inset-0 opacity-40" />
          <div className="absolute -left-16 -top-16 h-48 w-48 rounded-full bg-sidebar-primary/20 blur-3xl" />
          <div className="absolute -bottom-16 -right-16 h-48 w-48 rounded-full bg-success/20 blur-3xl" />

          <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-5">
            <h2 className="font-display text-3xl leading-tight tracking-tight text-sidebar-accent-foreground sm:text-4xl">
              {heading}
            </h2>
            {subheading ? (
              <p className="text-base leading-relaxed text-sidebar-foreground/80 sm:text-lg">
                {subheading}
              </p>
            ) : null}
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <CtaPanelButton cta={primaryCta} primary />
              {secondaryCta ? <CtaPanelButton cta={secondaryCta} /> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** CTA buttons styled for the dark navy panel (the design tokens flip here). */
function CtaPanelButton({ cta, primary = false }: { cta: PublicCta; primary?: boolean }) {
  return (
    <Button
      asChild
      size="lg"
      className={cn(
        primary
          ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
          : "border border-sidebar-border bg-transparent text-sidebar-accent-foreground hover:bg-sidebar-accent",
      )}
    >
      <Link to={cta.to}>{cta.label}</Link>
    </Button>
  );
}
