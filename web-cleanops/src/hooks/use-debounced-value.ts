import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delayMs` have
 * passed without further changes. Used to keep search inputs responsive while
 * deferring the (potentially expensive) downstream filtering / future server
 * query until the user pauses typing.
 *
 * Reusable across any list/search surface and safe to keep after the future
 * Supabase migration — the debounced value can drive a network query unchanged.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = 350): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
