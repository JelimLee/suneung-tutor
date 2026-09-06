"""Pydantic schemas — locked to the Edge function's request/response shape.

The frontend today calls `supabase.functions.invoke('grade-topic', { body: { word, topic, passage } })`
and reads `data.graded`. Keeping these models byte-compatible means the frontend
can later swap the URL only (Edge → FastAPI) with no payload changes.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

# The five topic buckets the grader may return. Mirrors GRADES in the Edge fn
# and TopicGrade in src/lib/solve/gradeTopic.ts.
GRADES = [
    "accept",
    "reject_too_narrow",
    "reject_too_broad",
    "reject_wrong",
    "ambiguous",
]


class Topic(BaseModel):
    """The rubric `topic` object. Every bucket is optional, matching the Edge fn
    which treats missing arrays as empty."""

    # Allow unknown keys so future rubric fields don't 422 the request.
    model_config = ConfigDict(extra="allow")

    canonical: Optional[str] = None
    accept: Optional[List[str]] = None
    reject_too_narrow: Optional[List[str]] = None
    reject_too_broad: Optional[List[str]] = None
    reject_wrong: Optional[List[str]] = None
    note: Optional[str] = None


class GradeTopicRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    # word/topic required — the Edge fn 400s when either is falsy. We validate
    # that in the router (not here) so we can return the exact Edge error body.
    word: Optional[str] = None
    topic: Optional[Topic] = None
    passage: Optional[str] = None


class GradeTopicResponse(BaseModel):
    """Byte-identical to the Edge success body: {graded, reason, provider, model}.

    `provider`/`model` carry MEASURED provenance (see memory: model-provenance):
      - rule tier (0 tokens): provider="rule", model=None
      - llm tier            : provider="openai"|"gateway", model=the model actually called
    """

    graded: str
    reason: str = ""
    provider: str
    model: Optional[str] = None


class GradeTopicError(BaseModel):
    """The Edge fn's validation-error body: {"error": "..."}."""

    error: str
