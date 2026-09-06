"""POST /grade-topic — 2-tier 소재 grader, response byte-compatible with the Edge fn.

Flow (mirrors the Edge fn + the client-side matcher it pairs with):
  1. Validate the caller's JWT (GoTrue). No user → 401 "Unauthorized".
  2. Require word + topic. Missing → 400 {"error": "word/topic이 필요합니다."}.
  3. Tier 1 — rule match (0 tokens). Decisive → return it (provider="rule").
  4. Tier 2 — LLM fallback. Return {graded, reason, provider, model}.
  5. Any failure is a nudge, not a gate → 200 {graded:"ambiguous", ...}.
"""

from __future__ import annotations

from fastapi import APIRouter, Header, Response
from fastapi.responses import JSONResponse

from models import GradeTopicRequest
from services.llm import grade_with_llm
from services.supabase_auth import get_user
from services.topic_rule import match_topic_rule

router = APIRouter()


@router.post("/grade-topic")
async def grade_topic(
    req: GradeTopicRequest,
    authorization: str | None = Header(default=None),
):
    # 1. JWT — reject anonymous/absent callers exactly like the Edge fn.
    user = await get_user(authorization)
    if not user:
        # Edge returns a plain-text "Unauthorized" body with status 401.
        return Response("Unauthorized", status_code=401)

    # 2. word/topic required (Edge: 400 with this exact body).
    if not req.word or not req.topic:
        return JSONResponse(
            {"error": "word/topic이 필요합니다."}, status_code=400
        )

    word = req.word
    topic = req.topic

    try:
        # 3. Tier 1 — 0-token rule matcher.
        graded, _matched = match_topic_rule(word, topic)
        if graded != "ambiguous":
            # Measured provenance: no LLM ran.
            return {"graded": graded, "reason": "", "provider": "rule", "model": None}

        # 4. Tier 2 — LLM fallback.
        graded, reason, provider, model = await grade_with_llm(word, topic, req.passage)
        return {"graded": graded, "reason": reason, "provider": provider, "model": model}
    except Exception as e:  # noqa: BLE001 — nudge must never gate learning.
        # Mirrors the Edge outer catch: 200 + ambiguous (no provider/model key).
        return JSONResponse(
            {"graded": "ambiguous", "reason": "", "error": str(e)}, status_code=200
        )
