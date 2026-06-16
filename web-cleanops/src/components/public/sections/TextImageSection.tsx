import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TextImageSectionConfig } from "@/lib/publicSite/types";

import {
  CtaButton,
  Eyebrow,
  Section,
  resolveSectionImage,
  type WebsiteImageMap,
} from "./sectionPrimitives";

/** Decorative placeholder visual used until a real image/asset is assigned. */
function PlaceholderVisual() {
  return (
    <div
      aria-hidden="true"
      className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary via-primary/90 to-accent-foreground shadow-lg"
    >
      <div className="grain absolute inset-0 opacity-30" />
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-success/30 blur-2xl" />
      <div className="absolute bottom-6 left-6 right-6 space-y-3">
        <div className="h-2.5 w-1/3 rounded-full bg-primary-foreground/30" />
        <div className="h-2.5 w-2/3 rounded-full bg-primary-foreground/20" />
        <div className="h-2.5 w-1/2 rounded-full bg-primary-foreground/20" />
      </div>
    </div>
  );
}

/** A two-column text + visual block. Visual side alternates per `imageSide`. */
export function TextImageSection({
  section,
  images,
}: {
  section: TextImageSectionConfig;
  images?: WebsiteImageMap;
}) {
  const { eyebrow, heading, body, bullets, imageSide = "right", cta } = section;
  const imageOnLeft = imageSide === "left";
  const image = resolveSectionImage(section.image, section.imageSlot, images, heading);

  const visual = (
    <div className={cn(imageOnLeft ? "lg:order-1" : "lg:order-2")}>
      {image ? (
        <div className="overflow-hidden rounded-2xl border border-border shadow-lg">
          <img
            src={image.src}
            alt={image.alt}
            className="aspect-[4/3] h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : (
        <PlaceholderVisual />
      )}
    </div>
  );

  const text = (
    <div className={cn("flex flex-col items-start gap-5", imageOnLeft ? "lg:order-2" : "lg:order-1")}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="font-display text-3xl leading-tight tracking-tight text-foreground sm:text-4xl">
        {heading}
      </h2>
      <div className="space-y-4">
        {body.map((paragraph, index) => (
          <p key={index} className="text-base leading-relaxed text-muted-foreground">
            {paragraph}
          </p>
        ))}
      </div>
      {bullets && bullets.length > 0 ? (
        <ul className="space-y-2.5">
          {bullets.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm text-foreground">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                <Check className="h-3 w-3" />
              </span>
              {item}
            </li>
          ))}
        </ul>
      ) : null}
      {cta ? (
        <div className="pt-1">
          <CtaButton cta={cta} size="default" />
        </div>
      ) : null}
    </div>
  );

  return (
    <Section>
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        {text}
        {visual}
      </div>
    </Section>
  );
}
