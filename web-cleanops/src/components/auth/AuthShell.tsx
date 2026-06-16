import { useEffect, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";

import { getLoginBackground } from "@/lib/assets/loginBranding";

/**
 * Built-in fallback for the auth brand panel, shown until/unless a Super Admin
 * picks a login background in the Media Center (or if it can't be loaded). The
 * live selection is read at runtime from the Asset Center — see
 * {@link getLoginBackground}.
 */
const DEFAULT_BRAND_MEDIA_URL =
  "https://swqcdcpwofdnmoureifu.supabase.co/storage/v1/object/public/public-assets/website/general/asset_flibhchjgc/original.mp4";

/** Renders a `.mp4`/`.webm`/`.mov` URL as a looping video, anything else as an image. */
function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url);
}

interface BrandMedia {
  url: string;
  isVideo: boolean;
}

const DEFAULT_BRAND_MEDIA: BrandMedia = {
  url: DEFAULT_BRAND_MEDIA_URL,
  isVideo: isVideoUrl(DEFAULT_BRAND_MEDIA_URL),
};

/** Full-bleed brand media (looping video or image) used as a panel background. */
function BrandMediaLayer({ media }: { media: BrandMedia }) {
  if (media.isVideo) {
    return (
      <video
        key={media.url}
        className="absolute inset-0 h-full w-full object-cover"
        src={media.url}
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
        tabIndex={-1}
      />
    );
  }
  return (
    <img
      key={media.url}
      className="absolute inset-0 h-full w-full object-cover"
      src={media.url}
      alt=""
      aria-hidden="true"
    />
  );
}

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Split-screen auth layout: brand panel + form card. */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  // Start with the built-in default so the panel is never blank, then swap in
  // the Super-Admin-configured background once it resolves (public read, works
  // for logged-out visitors). Any failure silently keeps the default.
  const [media, setMedia] = useState<BrandMedia>(DEFAULT_BRAND_MEDIA);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const background = await getLoginBackground();
        if (active && background) {
          setMedia({ url: background.url, isVideo: background.mediaType === "video" });
        }
      } catch {
        // Keep the default background.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Brand panel */}
      <aside className="relative hidden w-1/2 overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <BrandMediaLayer media={media} />
        {/* Brand-tinted scrim keeps the logo, tagline and tags readable over the media */}
        <div className="absolute inset-0 bg-sidebar/55" />
        <div className="absolute inset-0 bg-gradient-to-t from-sidebar via-sidebar/30 to-sidebar/60" />
        <div className="grain absolute inset-0 opacity-40" />
        <div className="relative z-10 flex items-center gap-2.5 p-10">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-sidebar-accent-foreground">
            CleanOps
          </span>
        </div>

        <div className="relative z-10 max-w-md p-10">
          <p className="font-display text-3xl leading-tight text-sidebar-accent-foreground">
            The operating system for modern cleaning companies.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-sidebar-foreground/80">
            Manage companies, teams and clients from one calm, organised console
            built for facility service businesses.
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-6 p-10 text-xs text-sidebar-foreground/60">
          <span>Multi-tenant</span>
          <span className="h-1 w-1 rounded-full bg-sidebar-foreground/30" />
          <span>Role-based access</span>
          <span className="h-1 w-1 rounded-full bg-sidebar-foreground/30" />
          <span>Built in the Nordics</span>
        </div>
      </aside>

      {/* Form panel */}
      <main className="relative flex w-full flex-col items-center justify-center px-6 py-12 lg:w-1/2">
        {/* Mobile-only brand background — the left brand panel is hidden below lg,
            so the configured media fills the form screen behind a frosted card. */}
        <div className="absolute inset-0 overflow-hidden lg:hidden" aria-hidden="true">
          <BrandMediaLayer media={media} />
          <div className="absolute inset-0 bg-gradient-to-b from-background/45 via-background/20 to-background/55" />
          <div className="grain absolute inset-0 opacity-30" />
        </div>

        <div className="relative z-10 w-full max-w-sm animate-fade-up rounded-2xl border border-border/60 bg-card/80 p-6 shadow-xl backdrop-blur-xl sm:p-8 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold tracking-tight">CleanOps</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>

          <div className="mt-8">{children}</div>

          {footer ? <div className="mt-6 text-sm text-muted-foreground">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
