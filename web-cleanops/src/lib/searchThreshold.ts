/**
 * Shared search-threshold policy (Performance Policy §2.2).
 *
 * Free-text searches must not execute until the user has typed a meaningful
 * amount of input, but identifier-style lookups (customer number, employee id,
 * work order / booking ids) must remain instant. These pure helpers encode that
 * rule once so every list surface behaves consistently — and so the same rule
 * can gate a future server-side query without change.
 */

/** Minimum characters before a free-text search runs. */
export const DEFAULT_SEARCH_MIN_LENGTH = 5;

/**
 * Heuristic for identifier-style queries that bypass the min-length rule.
 * Customer numbers ("C-1001"), employee ids, work order ids and booking ids all
 * contain digits, whereas names/emails being typed character-by-character do
 * not. Any query containing a digit is therefore treated as an identifier and
 * allowed to execute immediately.
 */
export function looksLikeIdentifier(raw: string): boolean {
  const q = raw.trim();
  if (!q) return false;
  return /\d/.test(q);
}

export interface SearchThresholdOptions {
  /**
   * When true, whitespace counts toward the minimum-length check. Typing
   * "Anna " (with a trailing space) then reaches a 5-char threshold even though
   * the trimmed query is only 4 characters. The query used for matching stays
   * trimmed regardless — this only affects when the search is allowed to run.
   */
  countWhitespace?: boolean;
}

export interface SearchThresholdResult {
  /** Normalised query to actually search with, or "" when nothing should run. */
  activeQuery: string;
  /** Whether a search should execute for the current input. */
  shouldSearch: boolean;
  /** True when the user has typed something but it is below the threshold. */
  belowThreshold: boolean;
}

/**
 * Evaluates a raw search input against the threshold policy.
 *
 * - Empty input → no search, no helper message.
 * - Identifier-style input → search immediately at any length.
 * - Otherwise → search only once `minLength` characters are entered, and signal
 *   {@link SearchThresholdResult.belowThreshold} so the UI can show a neutral hint.
 */
export function evaluateSearchThreshold(
  raw: string,
  minLength: number = DEFAULT_SEARCH_MIN_LENGTH,
  options: SearchThresholdOptions = {},
): SearchThresholdResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { activeQuery: "", shouldSearch: false, belowThreshold: false };
  }
  // The length used to gate the search. With countWhitespace the raw input
  // length is used so spaces count toward the threshold; the query we actually
  // search with is always the trimmed value.
  const gateLength = options.countWhitespace ? raw.length : trimmed.length;
  if (looksLikeIdentifier(trimmed) || gateLength >= minLength) {
    return { activeQuery: trimmed, shouldSearch: true, belowThreshold: false };
  }
  return { activeQuery: "", shouldSearch: false, belowThreshold: true };
}
