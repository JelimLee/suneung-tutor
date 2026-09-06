"""Tier-1 grader: 0-token rule matcher.

Faithful Python port of src/lib/solve/gradeTopic.ts (matchTopicRule). Same
normalization, same two-pass logic, same tie-breaks. This is a NUDGE only — it
never gates advancing. When it returns 'ambiguous', the router falls back to the
LLM (tier 2), exactly as the frontend does today.

Keeping this identical to the TS matcher is a correctness requirement: any drift
means the FastAPI and the client-side matcher would disagree on the same input.
"""

from __future__ import annotations

import re
from typing import List, Optional, Tuple

from models import Topic

# Keep hangul, ascii letters, digits — drop everything else (punctuation/space).
_NORM_STRIP = re.compile(r"[^가-힣a-z0-9]")


def norm(s: Optional[str]) -> str:
    """lowercase, keep hangul/ascii/digits, drop punctuation & spaces."""
    return _NORM_STRIP.sub("", (s or "").lower())


def hit(word: str, entry: str) -> bool:
    """Bidirectional substring overlap with min shared length 2 (same as theme.ts).

    Because one normalized string must fully contain the other, the shared length
    equals the shorter string's length, so requiring both >= 2 enforces the
    min-shared-length rule.
    """
    a = norm(word)
    b = norm(entry)
    if len(a) < 2 or len(b) < 2:
        return False
    return (b in a) or (a in b)


def match_topic_rule(word: str, topic: Topic) -> Tuple[str, Optional[str]]:
    """Return (graded, matched_against). Mirrors matchTopicRule in gradeTopic.ts.

    Pass 1 — exact normalized equality, accept first (an explicit accept listing
    must beat an incidental substring collision in a reject bucket).
    Pass 2 — bidirectional substring, rejects BEFORE accept (trap words that
    appear only as substrings must still be rejected).
    """
    w = norm(word)
    if len(w) < 2:
        return ("ambiguous", None)

    # canonical counts as accept material alongside the accept array.
    accept_entries: List[str] = list(topic.accept or [])
    if topic.canonical:
        accept_entries.append(topic.canonical)

    reject_buckets = [
        ("reject_wrong", topic.reject_wrong or []),
        ("reject_too_broad", topic.reject_too_broad or []),
        ("reject_too_narrow", topic.reject_too_narrow or []),
    ]
    accept = ("accept", accept_entries)

    # Pass 1 — exact equality, accept first.
    for name, entries in [accept, *reject_buckets]:
        if any(norm(e) == w for e in entries):
            return (name, name)

    # Pass 2 — substring, rejects before accept.
    for name, entries in [*reject_buckets, accept]:
        if any(hit(word, e) for e in entries):
            return (name, name)

    return ("ambiguous", None)
