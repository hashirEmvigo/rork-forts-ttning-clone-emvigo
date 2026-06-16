import type { PublicPageConfig } from "./types";

/**
 * The public marketing site, defined as data. Each entry is one route. Editing
 * H1/H2/H3 copy, subtitles, body text, CTAs and (later) imagery happens here —
 * the rendering components never need to change. Keep `path` and
 * `seo.canonicalPath` in sync (enforced by pages.test.ts).
 *
 * Copy is professional placeholder content for Städportalen / CleanOps and is
 * expected to be revised by the team.
 */
export const PUBLIC_PAGES: PublicPageConfig[] = [
  {
    slug: "home",
    path: "/",
    seo: {
      title: "Städportalen — Operations software for cleaning companies",
      description:
        "Städportalen is the calm, all-in-one platform that helps cleaning companies plan shifts, prove quality and delight customers — built in the Nordics.",
      canonicalPath: "/",
    },
    sections: [
      {
        type: "hero",
        eyebrow: "Built in the Nordics",
        heading: "The operating system for modern cleaning companies",
        imageSlot: "home_hero",
        subheading:
          "Plan every shift, prove every clean and keep customers informed — from one calm, organised console designed for facility service teams.",
        primaryCta: { label: "Get started", to: "/get-started", variant: "primary" },
        secondaryCta: { label: "Explore features", to: "/features", variant: "secondary" },
        highlights: [
          "Smart scheduling & booking",
          "Digital quality checklists",
          "Customer & team portals",
        ],
        stats: [
          { value: "1 console", label: "for your whole operation" },
          { value: "Role-based", label: "access for every team" },
          { value: "Multi-tenant", label: "secure by design" },
        ],
      },
      {
        type: "featureGrid",
        eyebrow: "One platform",
        heading: "Everything your cleaning business runs on",
        subheading:
          "Replace scattered spreadsheets and chat threads with a single source of truth for planning, people and proof of work.",
        columns: 3,
        features: [
          {
            icon: "calendar",
            title: "Scheduling & bookings",
            body: "Build recurring schedules, fill open shifts and adapt single visits without touching the whole series.",
          },
          {
            icon: "checklist",
            title: "Quality protocols",
            body: "Turn every assignment into a digital checklist your team completes on site — with a clear record afterwards.",
          },
          {
            icon: "team",
            title: "Teams & roles",
            body: "Give office staff, field teams and customers exactly the access they need, and nothing they don't.",
          },
          {
            icon: "customer",
            title: "Customer portal",
            body: "Share schedules, protocols and updates so clients always know what was done and when.",
          },
          {
            icon: "clock",
            title: "Time reporting",
            body: "Capture worked time against each visit and approve deviations with a tolerance you control.",
          },
          {
            icon: "analytics",
            title: "Operational insight",
            body: "See workload, coverage and quality at a glance, so you can plan the week with confidence.",
          },
        ],
      },
      {
        type: "textImage",
        eyebrow: "Planning",
        heading: "Plan every shift with confidence",
        imageSlot: "home_planning",
        body: [
          "Städportalen turns messy recurring work into a clear, living schedule. Generate visits months ahead, then reschedule, reassign or cancel a single occurrence without disturbing the rest of the series.",
          "When something changes on the ground, your plan keeps up — and everyone sees the same up-to-date picture.",
        ],
        bullets: [
          "Recurring schedules with per-visit exceptions",
          "Open shifts and clear staffing indicators",
          "A booking queue that bridges sales and operations",
        ],
        imageSide: "right",
        cta: { label: "See scheduling", to: "/features", variant: "ghost" },
      },
      {
        type: "textImage",
        eyebrow: "Quality",
        heading: "Quality you can prove",
        imageSlot: "home_quality",
        body: [
          "Standardise how work gets done with reusable checklist templates, then attach them to customers and assignments. Field teams complete protocols on site, and the result becomes a record you can share.",
          "No more wondering whether a task was finished — the proof lives alongside the booking.",
        ],
        bullets: [
          "Reusable template and protocol libraries",
          "On-site completion from any device",
          "A shareable history for every customer",
        ],
        imageSide: "left",
        cta: { label: "Browse services", to: "/services", variant: "ghost" },
      },
      {
        type: "cta",
        heading: "Ready to bring calm to your operations?",
        subheading:
          "Start organising your cleaning company on a platform built for the way you actually work.",
        primaryCta: { label: "Get started", to: "/get-started", variant: "primary" },
        secondaryCta: { label: "Talk to us", to: "/contact", variant: "secondary" },
      },
    ],
  },
  {
    slug: "features",
    path: "/features",
    navLabel: "Features",
    seo: {
      title: "Features — Städportalen for cleaning operations",
      description:
        "Scheduling, digital quality protocols, team and customer portals, time reporting and insight — explore the features behind Städportalen.",
      canonicalPath: "/features",
    },
    sections: [
      {
        type: "hero",
        eyebrow: "Features",
        heading: "Built for the realities of facility services",
        imageSlot: "features_hero",
        subheading:
          "Every part of Städportalen is shaped around how cleaning companies plan, deliver and prove their work — from the back office to the field.",
        primaryCta: { label: "Get started", to: "/get-started", variant: "primary" },
        secondaryCta: { label: "Contact sales", to: "/contact", variant: "secondary" },
      },
      {
        type: "featureGrid",
        eyebrow: "Core modules",
        heading: "A connected toolkit, not another silo",
        columns: 3,
        features: [
          {
            icon: "calendar",
            title: "Smart scheduling",
            body: "Recurring bookings, single-visit exceptions and clear staffing so the week always adds up.",
          },
          {
            icon: "route",
            title: "Booking queue",
            body: "A planning layer between work orders and the schedule that keeps sales and operations aligned.",
          },
          {
            icon: "checklist",
            title: "Checklist manager",
            body: "Design template libraries once and reuse them across customers and assignments.",
          },
          {
            icon: "shield",
            title: "Quality control",
            body: "Capture proof of work on site and keep a defensible quality record for every client.",
          },
          {
            icon: "clock",
            title: "Time reporting",
            body: "Compare scheduled and actual time, with automatic approval inside your tolerance.",
          },
          {
            icon: "customer",
            title: "Customer portal",
            body: "Give clients a calm window into their schedules, protocols and cleaning preferences.",
          },
          {
            icon: "team",
            title: "Teams & access",
            body: "Role-based permissions keep every person focused on exactly what they need.",
          },
          {
            icon: "map",
            title: "Areas & districts",
            body: "Organise customers and staff by area so planning reflects how your teams really move.",
          },
          {
            icon: "building",
            title: "Multi-company",
            body: "Run multiple companies on one secure, multi-tenant platform with clean separation.",
          },
        ],
      },
      {
        type: "textImage",
        eyebrow: "Office to field",
        heading: "One source of truth, everywhere",
        imageSlot: "features_office_field",
        body: [
          "Planners work in a focused console, field teams see only their assignments, and customers get a clear portal — all powered by the same data.",
          "Because everything is connected, a change in the office is instantly reflected wherever it matters.",
        ],
        bullets: [
          "Consistent data across office, field and customer",
          "Permission-aware views for every role",
          "Built-in audit trail for key actions",
        ],
        imageSide: "right",
      },
      {
        type: "faq",
        eyebrow: "Good to know",
        heading: "Common questions about features",
        items: [
          {
            question: "Can we start with just scheduling?",
            answer:
              "Yes. Städportalen is modular — begin with planning and bookings, then switch on quality protocols, portals and reporting as you grow.",
          },
          {
            question: "Does it support recurring cleaning contracts?",
            answer:
              "Absolutely. Recurring schedules are first-class, and you can adjust an individual visit without breaking the wider series.",
          },
          {
            question: "Can customers see their cleaning history?",
            answer:
              "With the customer portal, clients can view their schedules, completed protocols and preferences in a clean, read-only view.",
          },
        ],
      },
      {
        type: "cta",
        heading: "See it with your own workflows",
        subheading: "Bring your schedules and we'll show you how they look in Städportalen.",
        primaryCta: { label: "Get started", to: "/get-started", variant: "primary" },
        secondaryCta: { label: "Talk to us", to: "/contact", variant: "secondary" },
      },
    ],
  },
  {
    slug: "services",
    path: "/services",
    navLabel: "Services",
    seo: {
      title: "Services — Städportalen platform & onboarding",
      description:
        "From guided onboarding to ongoing support, see how Städportalen helps cleaning companies get up and running and keep operations running smoothly.",
      canonicalPath: "/services",
    },
    sections: [
      {
        type: "hero",
        eyebrow: "Services",
        heading: "Set up for success, then supported for the long run",
        imageSlot: "services_hero",
        subheading:
          "We pair the platform with hands-on onboarding and ongoing support so your team feels confident from day one.",
        primaryCta: { label: "Get started", to: "/get-started", variant: "primary" },
        secondaryCta: { label: "Contact us", to: "/contact", variant: "secondary" },
      },
      {
        type: "featureGrid",
        eyebrow: "What we offer",
        heading: "Services that go beyond software",
        columns: 3,
        features: [
          {
            icon: "workflow",
            title: "Guided onboarding",
            body: "We help you model your customers, schedules and teams so the platform fits your operation.",
          },
          {
            icon: "layers",
            title: "Data setup",
            body: "Bring your existing structure — areas, services and recurring work — into a clean foundation.",
          },
          {
            icon: "handshake",
            title: "Ongoing support",
            body: "A responsive team that understands cleaning operations is there when you need a hand.",
          },
          {
            icon: "shield",
            title: "Security & isolation",
            body: "Multi-tenant by design, with strict separation so each company's data stays private.",
          },
          {
            icon: "growth",
            title: "Grow at your pace",
            body: "Switch on additional capabilities as your business expands — no disruptive migrations.",
          },
          {
            icon: "language",
            title: "Nordic-first",
            body: "Built with Nordic facility service businesses in mind, from terminology to workflows.",
          },
        ],
      },
      {
        type: "textImage",
        eyebrow: "Implementation",
        heading: "A calm path from sign-up to live",
        imageSlot: "services_implementation",
        body: [
          "Getting started shouldn't mean months of disruption. We work with you to configure the essentials first, then layer in the rest once your team is comfortable.",
          "The result is an operation that feels organised — not overwhelmed by new tooling.",
        ],
        bullets: [
          "Start with the modules that matter most",
          "Keep your existing structure intact",
          "Bring your team along step by step",
        ],
        imageSide: "left",
        cta: { label: "See how onboarding works", to: "/get-started", variant: "ghost" },
      },
      {
        type: "cta",
        heading: "Let's map out your setup",
        subheading: "Tell us about your operation and we'll suggest the right starting point.",
        primaryCta: { label: "Get started", to: "/get-started", variant: "primary" },
        secondaryCta: { label: "Contact us", to: "/contact", variant: "secondary" },
      },
    ],
  },
  {
    slug: "get-started",
    path: "/get-started",
    seo: {
      title: "Get started with Städportalen",
      description:
        "Get your cleaning company up and running on Städportalen. See how onboarding works, what to prepare, and start organising your operations today.",
      canonicalPath: "/get-started",
    },
    sections: [
      {
        type: "hero",
        eyebrow: "Get started",
        heading: "Bring calm to your cleaning operations",
        imageSlot: "get_started_hero",
        subheading:
          "Tell us a little about your company and we'll help you map customers, schedules and teams onto Städportalen.",
        primaryCta: { label: "Sign in", to: "/login", variant: "primary" },
        secondaryCta: { label: "Contact us", to: "/contact", variant: "secondary" },
      },
      {
        type: "featureGrid",
        eyebrow: "How it works",
        heading: "Three steps to a connected operation",
        columns: 3,
        features: [
          {
            icon: "handshake",
            title: "1 · Get in touch",
            body: "Share where you are today — your customers, recurring work and the team that runs it.",
          },
          {
            icon: "workflow",
            title: "2 · Configure together",
            body: "We help set up areas, services and schedules so the platform mirrors your operation.",
          },
          {
            icon: "sparkles",
            title: "3 · Go live calmly",
            body: "Your team starts with the essentials, then adds modules as confidence grows.",
          },
        ],
      },
      {
        type: "faq",
        eyebrow: "Before you start",
        heading: "What to prepare",
        items: [
          {
            question: "What information should we have ready?",
            answer:
              "A list of your active customers, the recurring work you deliver, and the people who carry it out is a great starting point.",
          },
          {
            question: "Do we need to migrate everything at once?",
            answer:
              "No. We recommend starting with your core scheduling and customers, then layering in protocols, portals and reporting over time.",
          },
          {
            question: "Already have an account?",
            answer:
              "If your workspace is set up, simply sign in to continue. New to Städportalen? Get in touch and we'll help you begin.",
          },
        ],
      },
      {
        type: "cta",
        heading: "Start today",
        subheading: "Sign in to your workspace, or reach out and we'll help you get set up.",
        primaryCta: { label: "Sign in", to: "/login", variant: "primary" },
        secondaryCta: { label: "Contact us", to: "/contact", variant: "secondary" },
      },
    ],
  },
  {
    slug: "about",
    path: "/about",
    navLabel: "About",
    seo: {
      title: "About Städportalen",
      description:
        "Städportalen is on a mission to bring calm, modern software to the cleaning industry — built in the Nordics for facility service companies.",
      canonicalPath: "/about",
    },
    sections: [
      {
        type: "hero",
        eyebrow: "About us",
        heading: "Modern software for an essential industry",
        imageSlot: "about_hero",
        subheading:
          "Cleaning keeps the world running. We build the calm, capable platform that helps the companies behind it run beautifully.",
      },
      {
        type: "textImage",
        eyebrow: "Our mission",
        heading: "Calm tools for hard-working teams",
        imageSlot: "about_mission",
        body: [
          "Facility service companies juggle people, schedules and quality every single day, often with tools that weren't made for them. Städportalen exists to change that.",
          "We bring planning, quality and communication into one organised console — so teams can spend less time wrangling software and more time delivering great work.",
        ],
        bullets: [
          "Designed around real cleaning operations",
          "Calm, focused and trustworthy by default",
          "Built and supported in the Nordics",
        ],
        imageSide: "right",
      },
      {
        type: "featureGrid",
        eyebrow: "What we value",
        heading: "Principles that guide us",
        columns: 3,
        features: [
          {
            icon: "handshake",
            title: "Built with operators",
            body: "We design alongside the people who plan and deliver cleaning every day.",
          },
          {
            icon: "shield",
            title: "Trust first",
            body: "Security, privacy and clean data separation are foundations, not features.",
          },
          {
            icon: "eco",
            title: "Built to last",
            body: "We favour calm, durable design over noisy trends that don't serve your team.",
          },
        ],
      },
      {
        type: "cta",
        heading: "Let's build calmer operations together",
        primaryCta: { label: "Get started", to: "/get-started", variant: "primary" },
        secondaryCta: { label: "Contact us", to: "/contact", variant: "secondary" },
      },
    ],
  },
  {
    slug: "contact",
    path: "/contact",
    navLabel: "Contact",
    seo: {
      title: "Contact Städportalen",
      description:
        "Get in touch with the Städportalen team. We'd love to hear about your cleaning operation and help you find the right starting point.",
      canonicalPath: "/contact",
    },
    sections: [
      {
        type: "hero",
        eyebrow: "Contact",
        heading: "We'd love to hear from you",
        imageSlot: "contact_hero",
        subheading:
          "Questions about the platform, onboarding or pricing? Reach out and a real person will get back to you.",
        primaryCta: { label: "Email us", to: "/contact", variant: "primary" },
        secondaryCta: { label: "Get started", to: "/get-started", variant: "secondary" },
      },
      {
        type: "contactForm",
        eyebrow: "Get in touch",
        heading: "Talk to the team",
        body: [
          "Tell us about your cleaning company and what you're hoping to improve. Whether you're just exploring or ready to begin, we're happy to help.",
        ],
        email: "hello@stadportalen.se",
        points: [
          "We typically reply within one business day",
          "Support for existing customers via your workspace",
          "Based in the Nordics",
        ],
      },
      {
        type: "faq",
        eyebrow: "Questions",
        heading: "Before you reach out",
        items: [
          {
            question: "Are you taking on new companies?",
            answer:
              "Yes. We're onboarding cleaning companies of different sizes — get in touch and we'll find the right starting point.",
          },
          {
            question: "I'm an existing customer and need help.",
            answer:
              "Sign in to your workspace for support, or contact us and we'll point you in the right direction.",
          },
        ],
      },
      {
        type: "cta",
        heading: "Ready when you are",
        primaryCta: { label: "Get started", to: "/get-started", variant: "primary" },
        secondaryCta: { label: "Sign in", to: "/login", variant: "secondary" },
      },
    ],
  },
];

/** Resolves a public page config by its slug, or null when unknown. */
export function getPublicPage(slug: string): PublicPageConfig | null {
  return PUBLIC_PAGES.find((page) => page.slug === slug) ?? null;
}

/** Pages that should appear in the primary header navigation, in order. */
export function getPublicNavPages(): PublicPageConfig[] {
  return PUBLIC_PAGES.filter((page) => Boolean(page.navLabel));
}
