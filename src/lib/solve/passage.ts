// Passage utilities for the 빈칸 solve flow. The blank marker in the DB is a
// run of underscores (confirmed against live data: e.g. "______________").

const BLANK_RE = /_{3,}/

/**
 * Splits a passage into sentences. Primary split breaks on sentence-final
 * punctuation followed by whitespace and a capital/quote start. If that yields
 * fewer than 2 segments (e.g. abbreviations, unusual casing), fall back to a
 * looser split on any sentence-final punctuation + whitespace.
 */
export function segmentSentences(passage: string): string[] {
  const normalized = passage.replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  const primary = normalized
    .split(/(?<=[.!?])\s+(?=[A-Z"'“‘])/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (primary.length >= 2) return primary

  const fallback = normalized
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  return fallback.length ? fallback : [normalized]
}

/**
 * Finds the sentence containing the blank (underscore run). If none matches,
 * returns the last sentence with found:false so the UI can still show context.
 */
export function findBlankSentence(passage: string): {
  sentence: string
  found: boolean
} {
  const sentences = segmentSentences(passage)
  const hit = sentences.find((s) => BLANK_RE.test(s))
  if (hit) return { sentence: hit, found: true }
  const last = sentences[sentences.length - 1] ?? passage.trim()
  return { sentence: last, found: false }
}

export { BLANK_RE }
