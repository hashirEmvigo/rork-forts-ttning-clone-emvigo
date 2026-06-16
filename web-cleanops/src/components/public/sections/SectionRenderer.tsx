import type { PublicSection } from "@/lib/publicSite/types";

import { CTASection } from "./CTASection";
import { ContactFormSection } from "./ContactFormSection";
import { FAQSection } from "./FAQSection";
import { FeatureGrid } from "./FeatureGrid";
import { HeroSection } from "./HeroSection";
import { TextImageSection } from "./TextImageSection";
import type { WebsiteImageMap } from "./sectionPrimitives";

/** Renders a single config section by dispatching on its discriminant `type`. */
export function SectionRenderer({
  section,
  images,
}: {
  section: PublicSection;
  /** Resolved Media Center images for the page, keyed by slot. */
  images?: WebsiteImageMap;
}) {
  switch (section.type) {
    case "hero":
      return <HeroSection section={section} images={images} />;
    case "featureGrid":
      return <FeatureGrid section={section} />;
    case "textImage":
      return <TextImageSection section={section} images={images} />;
    case "cta":
      return <CTASection section={section} />;
    case "faq":
      return <FAQSection section={section} />;
    case "contactForm":
      return <ContactFormSection section={section} />;
    default: {
      // Exhaustiveness guard: a new section type must be handled above.
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
}
