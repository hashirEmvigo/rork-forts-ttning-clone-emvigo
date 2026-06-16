import { cn } from "@/lib/utils";
import { ICON_REGISTRY } from "@/lib/publicSite/icons";
import type { FeatureGridSectionConfig } from "@/lib/publicSite/types";

import { Section, SectionHeading } from "./sectionPrimitives";

/** A responsive grid of feature cards, each with a tinted icon, title and body. */
export function FeatureGrid({ section }: { section: FeatureGridSectionConfig }) {
  const { eyebrow, heading, subheading, features, columns = 3 } = section;

  return (
    <Section muted>
      <SectionHeading eyebrow={eyebrow} heading={heading} subheading={subheading} />
      <ul
        className={cn(
          "mt-14 grid gap-5 sm:grid-cols-2",
          columns === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2",
        )}
      >
        {features.map((feature) => {
          const Icon = ICON_REGISTRY[feature.icon];
          return (
            <li
              key={feature.title}
              className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-foreground">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
