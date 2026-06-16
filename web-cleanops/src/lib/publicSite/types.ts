import type { IconKey } from "./icons";
import type { WebsiteImageSlotKey } from "./imageSlots";

/** Per-page SEO metadata consumed by the {@link Seo} head manager. */
export interface SeoConfig {
  title: string;
  description: string;
  /** Must equal the page's own route path (validated in tests). */
  canonicalPath: string;
  ogImage?: string;
}

/**
 * A reference to a visual asset. For now this carries a direct `src` URL plus
 * alt text; the shape is intentionally future-proofed so a later slice can add
 * an Asset Center `assetId` and resolve the URL at render time.
 */
export interface PublicImageRef {
  src: string;
  alt: string;
  /** Reserved for a future Asset Center integration. */
  assetId?: string;
}

/** A call-to-action button. `to` is always an internal route path. */
export interface PublicCta {
  label: string;
  to: string;
  variant?: "primary" | "secondary" | "ghost";
}

/** A single feature card in a {@link FeatureGridSection}. */
export interface FeatureItem {
  icon: IconKey;
  title: string;
  body: string;
}

/** A question/answer pair in a {@link FaqSection}. */
export interface FaqItem {
  question: string;
  answer: string;
}

/** A headline statistic shown in a hero. */
export interface StatItem {
  value: string;
  label: string;
}

export interface HeroSectionConfig {
  type: "hero";
  eyebrow?: string;
  /** The page's H1. */
  heading: string;
  subheading?: string;
  primaryCta?: PublicCta;
  secondaryCta?: PublicCta;
  highlights?: string[];
  stats?: StatItem[];
  image?: PublicImageRef;
  /**
   * Optional Media Center placement slot. When a Super Admin has assigned a
   * PUBLIC image to this slot, it overrides {@link image} at render time;
   * otherwise the static `image` (or a built-in placeholder) is used.
   */
  imageSlot?: WebsiteImageSlotKey;
}

export interface FeatureGridSectionConfig {
  type: "featureGrid";
  eyebrow?: string;
  heading?: string;
  subheading?: string;
  columns?: 2 | 3;
  features: FeatureItem[];
}

export interface TextImageSectionConfig {
  type: "textImage";
  eyebrow?: string;
  heading: string;
  body: string[];
  bullets?: string[];
  image?: PublicImageRef;
  /** Which side the visual sits on at desktop widths. Defaults to "right". */
  imageSide?: "left" | "right";
  cta?: PublicCta;
  /**
   * Optional Media Center placement slot. A Super-Admin-assigned PUBLIC image
   * overrides {@link image} at render time; otherwise the static `image` (or a
   * built-in placeholder) is used.
   */
  imageSlot?: WebsiteImageSlotKey;
}

export interface CtaSectionConfig {
  type: "cta";
  heading: string;
  subheading?: string;
  primaryCta: PublicCta;
  secondaryCta?: PublicCta;
}

export interface FaqSectionConfig {
  type: "faq";
  eyebrow?: string;
  heading?: string;
  items: FaqItem[];
}

export interface ContactFormSectionConfig {
  type: "contactForm";
  eyebrow?: string;
  heading: string;
  /** Intro paragraphs shown beside the form. */
  body?: string[];
  /**
   * Destination address for the composed email. On submit the form opens the
   * visitor's email client (mailto:) with a prefilled message — there is no
   * server-side inbox in this slice.
   */
  email: string;
  /** Short reassurance points shown under the intro (e.g. response time). */
  points?: string[];
}

/** Discriminated union of every section a public page can compose. */
export type PublicSection =
  | HeroSectionConfig
  | FeatureGridSectionConfig
  | TextImageSectionConfig
  | CtaSectionConfig
  | FaqSectionConfig
  | ContactFormSectionConfig;

/**
 * The complete, config-driven definition of one public marketing page. Content
 * lives here in code today; the shape is designed so it can later be sourced
 * from Supabase/a CMS without changing the rendering components.
 */
export interface PublicPageConfig {
  /** Stable id used by routes, e.g. "home", "services". */
  slug: string;
  /** Route path, e.g. "/" or "/services". */
  path: string;
  /** Header navigation label. Omit to keep the page out of the primary nav. */
  navLabel?: string;
  seo: SeoConfig;
  sections: PublicSection[];
}
