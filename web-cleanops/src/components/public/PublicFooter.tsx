import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";

import { PUBLIC_SITE_NAME } from "@/components/seo/Seo";

interface FooterLink {
  label: string;
  to: string;
}

interface FooterColumn {
  title: string;
  links: FooterLink[];
}

const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Features", to: "/features" },
      { label: "Services", to: "/services" },
      { label: "Get started", to: "/get-started" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "Contact", to: "/contact" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", to: "/login" },
      { label: "Reset password", to: "/forgot-password" },
    ],
  },
];

/** Public marketing footer: brand summary, link columns and a legal strip. */
export function PublicFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-muted/40">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="max-w-sm">
          <Link to="/" className="flex items-center gap-2.5" aria-label={`${PUBLIC_SITE_NAME} home`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-foreground">
              {PUBLIC_SITE_NAME}
            </span>
          </Link>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            The calm operating system for modern cleaning companies — planning, quality and
            communication in one organised console.
          </p>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <div key={column.title}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {column.title}
            </h2>
            <ul className="mt-4 space-y-2.5">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    to={link.to}
                    className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:px-8">
          <p>
            © {year} {PUBLIC_SITE_NAME}. All rights reserved.
          </p>
          <p>Built in the Nordics</p>
        </div>
      </div>
    </footer>
  );
}
