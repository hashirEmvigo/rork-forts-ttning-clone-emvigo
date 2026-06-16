import { CalendarClock, CheckCircle2, Clock } from "lucide-react";

import { cn } from "@/lib/utils";
import type { HeroSectionConfig } from "@/lib/publicSite/types";

import { CtaButton, Eyebrow, resolveSectionImage, type WebsiteImageMap } from "./sectionPrimitives";

/**
 * A self-contained "product preview" visual used when a hero has no image yet.
 * Built entirely from design tokens so it reads as a real schedule surface
 * without shipping any asset. Decorative only.
 */
function SchedulePreview() {
  const rows = [
    { name: "Nordic Office AB", time: "08:00", tone: "success" as const },
    { name: "Harbour Clinic", time: "10:30", tone: "primary" as const },
    { name: "Lindqvist Retail", time: "13:15", tone: "warning" as const },
  ];
  return (
    <div className="relative" aria-hidden="true">
      {/* Soft brand glow behind the card */}
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-primary/10 via-accent/40 to-success/10 blur-2xl" />
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
        {/* Window chrome */}
        <div className="flex items-center justify-between border-b border-border bg-muted/50 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <CalendarClock className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold text-foreground">Today's schedule</span>
          </div>
          <span className="rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success">
            On track
          </span>
        </div>

        {/* Mock visit rows */}
        <div className="space-y-2.5 p-5">
          {rows.map((row) => (
            <div
              key={row.name}
              className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "h-9 w-9 rounded-lg",
                    row.tone === "success" && "bg-success/15",
                    row.tone === "primary" && "bg-primary/15",
                    row.tone === "warning" && "bg-warning/20",
                  )}
                />
                <div className="leading-tight">
                  <p className="text-sm font-medium text-foreground">{row.name}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" /> {row.time}
                  </p>
                </div>
              </div>
              <CheckCircle2
                className={cn(
                  "h-5 w-5",
                  row.tone === "warning" ? "text-muted-foreground/40" : "text-success",
                )}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Floating stat chip */}
      <div className="absolute -bottom-5 -left-5 hidden rounded-2xl border border-border bg-card px-4 py-3 shadow-lg sm:block">
        <p className="text-xs text-muted-foreground">This week</p>
        <p className="font-display text-xl text-foreground">142 visits planned</p>
      </div>
    </div>
  );
}

/** The hero / page header. Its heading is the page's single H1. */
export function HeroSection({
  section,
  images,
}: {
  section: HeroSectionConfig;
  images?: WebsiteImageMap;
}) {
  const { eyebrow, heading, subheading, primaryCta, secondaryCta, highlights, stats } = section;
  const image = resolveSectionImage(section.image, section.imageSlot, images, heading);

  return (
    <section className="relative overflow-hidden">
      {/* Atmospheric background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-accent/40 via-background to-background" />
      <div className="grain absolute inset-0 -z-10 opacity-40" />
      <div className="absolute -right-32 -top-32 -z-10 h-80 w-80 rounded-full bg-success/10 blur-3xl" />

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-2 lg:gap-16 lg:py-28">
        <div className="flex flex-col items-start gap-6 animate-fade-up">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h1 className="font-display text-4xl leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            {heading}
          </h1>
          {subheading ? (
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">{subheading}</p>
          ) : null}

          {primaryCta || secondaryCta ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              {primaryCta ? <CtaButton cta={primaryCta} /> : null}
              {secondaryCta ? <CtaButton cta={secondaryCta} /> : null}
            </div>
          ) : null}

          {highlights && highlights.length > 0 ? (
            <ul className="flex flex-col gap-2.5 pt-2">
              {highlights.map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-sm text-foreground">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="animate-fade-up [animation-delay:120ms]">
          {image ? (
            <div className="overflow-hidden rounded-2xl border border-border shadow-xl">
              <img
                src={image.src}
                alt={image.alt}
                className="aspect-[4/3] h-full w-full object-cover"
                loading="eager"
              />
            </div>
          ) : (
            <SchedulePreview />
          )}
        </div>
      </div>

      {stats && stats.length > 0 ? (
        <div className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8 lg:pb-20">
          <dl className="grid grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm sm:grid-cols-3">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center sm:text-left">
                <dt className="sr-only">{stat.label}</dt>
                <dd>
                  <span className="font-display text-2xl text-foreground">{stat.value}</span>{" "}
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}
