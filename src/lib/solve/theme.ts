// Theme-recall overlap utilities. Compares a student's one-line theme against
// keywords extracted from the DB explanation — a NUDGE, never a gate.

// Korean particles / common stopwords to drop from keyword sets.
const KO_STOPWORDS = new Set([
  '은', '는', '이', '가', '을', '를', '에', '의', '도', '와', '과', '및',
  '수', '것', '등', '그', '저', '하는', '되는', '으로', '에서', '에게',
  '부터', '까지', '그리고', '하지만', '그러나',
])

/**
 * Tokenizes text into deduped keywords. Keeps Korean syllables, ASCII letters
 * and digits; drops punctuation, tokens shorter than 2 chars, and Korean
 * stopwords/particles.
 */
export function extractKeywords(text: string): string[] {
  if (!text) return []
  const cleaned = text
    .toLowerCase()
    // keep hangul syllables, ascii letters, digits, and whitespace
    .replace(/[^가-힣a-z0-9\s]/g, ' ')
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of cleaned.split(/\s+/)) {
    if (token.length < 2) continue
    if (KO_STOPWORDS.has(token)) continue
    if (seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}

/**
 * Computes overlap between the student's theme tokens and reference keywords.
 * A theme token t (len>=2) hits if it is a substring of some reference token r,
 * or r is a substring of t, with a minimum shared length of 2.
 * ratio = overlapCount / max(1, themeTokenCount).
 */
export function computeOverlap(
  themeTokens: string[],
  referenceKeywords: string[],
): { overlap: string[]; ratio: number } {
  const overlap: string[] = []
  const seen = new Set<string>()

  for (const t of themeTokens) {
    if (t.length < 2) continue
    const hit = referenceKeywords.some((r) => {
      if (r.length < 2) return false
      const shorter = t.length <= r.length ? t : r
      if (shorter.length < 2) return false
      return t.includes(r) || r.includes(t)
    })
    if (hit && !seen.has(t)) {
      seen.add(t)
      overlap.push(t)
    }
  }

  const ratio = overlap.length / Math.max(1, themeTokens.length)
  return { overlap, ratio }
}
