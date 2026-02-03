/**
 * Approximate token counting.
 *
 * Uses a simple heuristic (~4 chars per token for English text,
 * adjusted for code which tends to have shorter tokens).
 * This is sufficient for chunking decisions; we don't need exact counts.
 */

const CHARS_PER_TOKEN = 3.5;

/**
 * Approximate token count for a string.
 * Biased slightly high to avoid over-stuffing chunks.
 */
export function approximateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
