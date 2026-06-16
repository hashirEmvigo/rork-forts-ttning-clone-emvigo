import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WebsiteImage } from "@/lib/assets";
import type { PublicCta, PublicImageRef } from "@/lib/publicSite/types";

/** Resolved website images for the current page, keyed by slot. */
export type WebsiteImageMap = ReadonlyMap<string, WebsiteImage>;

/** A ready-to-render image source + alt text. */
export interface ResolvedImage {
  src: string;
  alt: string;
}

/**
 * Resolves the effective image for a section: a Super-Admin-assigned Media
 * Center image (by slot) wins, then the section's static {@link PublicImageRef},
 * otherwise null (the section shows its built-in placeholder). Only public URLs
 * ever reach here — see {@link @/lib/assets/websiteImagery}.
 */
export function resolveSectionImage(
  staticImage: PublicImageRef | undefined,
  slotKey: string | undefined,
  images: WebsiteImageMap | undefined,
  fallbackAlt: string,
): ResolvedImage | null {
  if (slotKey && images) {
    const assigned = images.get(slotKey);
    if (assigned) return { src: assigned.url, alt: assigned.alt || fallbackAlt };
  }
  if (staticImage) return { src: staticImage.src, alt: staticImage.alt };
  return null;
}

/** Maps a content-level CTA variant to the design system's button variant. */
function buttonVariantFor(variant: PublicCta["variant"]): "default" | "outline" | "ghost" {
  switch (variant) {
    case "secondary":
      return "outline";
    case "ghost":
      return "ghost";
    case "primary":
    default:
      return "default";
  }
}

/** Renders a single config CTA as a router-linked button. */
export function CtaButton({ cta, size = "lg" }: { cta: PublicCta; size?: "default" | "lg" }) {
  return (
    <Button asChild size={size} variant={buttonVariantFor(cta.variant)}>
      <Link to={cta.to}>{cta.label}</Link>
    </Button>
  );
}

/** Small uppercase eyebrow label used above section headings. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-success" />
      {children}
    </span>
  );
}

interface SectionProps {
  children: React.ReactNode;
  className?: string;
  /** Adds a subtly tinted background to create vertical rhythm between sections. */
  muted?: boolean;
  id?: string;
}

/** Standard vertical-rhythm wrapper with a centered max-width container. */
export function Section({ children, className, muted = false, id }: SectionProps) {
  return (
    <section id={id} className={cn("py-20 sm:py-24", muted && "bg-muted/40", className)}>
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">{children}</div>
    </section>
  );
}

/** Centered heading block (eyebrow + H2 + lead) shared across sections. */
export function SectionHeading({
  eyebrow,
  heading,
  subheading,
  align = "center",
}: {
  eyebrow?: string;
  heading?: string;
  subheading?: string;
  align?: "center" | "left";
}) {
  if (!eyebrow && !heading && !subheading) return null;
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        align === "center" ? "mx-auto max-w-2xl items-center text-center" : "items-start text-left",
      )}
    >
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      {heading ? (
        <h2 className="font-display text-3xl leading-tight tracking-tight text-foreground sm:text-4xl">
          {heading}
        </h2>
      ) : null}
      {subheading ? (
        <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">{subheading}</p>
      ) : null}
    </div>
  );
}
