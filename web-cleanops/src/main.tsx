import { createRoot } from "react-dom/client";

import "./index.css";
import { purgeClientDomainStorageForCurrentEpoch } from "./lib/clientDomainStorage";
import { installLegacyBrowserDomainToolQuarantine } from "./lib/data/runtimeQuarantine";
import { redirectRootAuthHashIfPresent } from "./lib/authRootHashRedirect";

// Defensive guard: if a Supabase auth email link (recovery/invite/signup) was
// misrouted to the site root as `/#access_token=...`, forward it to its
// dedicated route — preserving the token hash — before booting. This runs
// first, before the Supabase client (loaded with App.tsx) can parse and strip
// the URL hash. On a normal load it is a no-op and the app boots as usual.
if (!redirectRootAuthHashIfPresent()) {
  purgeClientDomainStorageForCurrentEpoch();
  installLegacyBrowserDomainToolQuarantine();

  void import("./App.tsx").then(({ default: App }) => {
    createRoot(document.getElementById("root")!).render(<App />);
  });
}
