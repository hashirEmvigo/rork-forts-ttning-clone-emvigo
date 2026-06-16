import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { FaqSectionConfig } from "@/lib/publicSite/types";

import { Section, SectionHeading } from "./sectionPrimitives";

/** A simple, accessible FAQ built on the design system's accordion. */
export function FAQSection({ section }: { section: FaqSectionConfig }) {
  const { eyebrow, heading, items } = section;

  return (
    <Section>
      <div className="mx-auto max-w-3xl">
        <SectionHeading eyebrow={eyebrow} heading={heading} />
        <Accordion type="single" collapsible className="mt-10 rounded-2xl border border-border bg-card px-5">
          {items.map((item, index) => (
            <AccordionItem
              key={item.question}
              value={`faq-${index}`}
              className={index === items.length - 1 ? "border-b-0" : undefined}
            >
              <AccordionTrigger className="text-left text-base font-medium text-foreground hover:no-underline">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </Section>
  );
}
