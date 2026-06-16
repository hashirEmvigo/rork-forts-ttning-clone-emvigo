import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "cleanops.sidebar.collapsed";

/**
 * Remembers the admin's sidebar collapse preference across sessions and pages.
 * Persisted to localStorage so the workspace stays maximized as the user navigates.
 */
export function useSidebarCollapsed(): {
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  toggle: () => void;
} {
  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // Ignore storage failures (private mode, quota) — preference is non-critical.
    }
  }, []);

  const toggle = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  // Keep multiple mounted layouts (and other tabs) in sync.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setCollapsedState(event.newValue === "1");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { collapsed, setCollapsed, toggle };
}
