"""Tier-2 grader: LLM fallback. Faithful port of the Edge fn's LLM path.

Same prompt (byte-for-byte), same system message, same max_tokens, same lenient
JSON extraction, same GRADES validation, same provider switch (openai↔gateway).
Provider/model returned are MEASURED (memory: model-provenance) — never hardcoded
independent of what actually ran.
"""

from __future__ import annotations

import json
import os
from typing import Optional, Tuple

import httpx

from models import GRADES, Topic

# ── LLM provider selection (mirrors the Edge fn) ─────────────────────────────
GATEWAY_URL = "https://factchat-cloud.mindlogic.ai/v1/gateway/chat/completions/"
GATEWAY_MODEL = "claude-sonnet-5"  # 게이트웨이 원복용 고정 모델
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL = "gpt-4o-mini"  # 값싼 소재 분류 호출

SYSTEM_MSG = "너는 정확한 JSON만 출력하는 소재 채점자다."


def _provider() -> str:
    return os.environ.get("LLM_PROVIDER") or "openai"


def _list(arr: Optional[list]) -> str:
    return ", ".join(arr) if arr else "(없음)"


def _first_sentence(passage: Optional[str]) -> str:
    if not passage:
        return ""
    collapsed = " ".join(passage.split()).strip()
    # split on sentence terminators followed by whitespace; take the first chunk.
    import re

    parts = re.split(r"(?<=[.!?])\s+", collapsed)
    return parts[0] if parts else ""


def build_prompt(word: str, topic: Topic, passage: Optional[str]) -> str:
    """Byte-for-byte port of buildPrompt() in the Edge fn."""
    first_sentence = _first_sentence(passage)
    intro = f"\n# 지문 첫 문장(참고)\n{first_sentence}" if first_sentence else ""
    return (
        "당신은 수능 영어 '빈칸 추론' 문제에서 학생이 적은 '소재 한 단어'를 채점하는 채점자입니다.\n"
        "채점이 아니라 방향을 잡아주는 넛지이므로, 관대하되 방향은 정확히 판별하세요.\n"
        "\n"
        "# 채점 철학\n"
        "- 방향이 맞으면 accept.\n"
        "- 방향은 맞지만 세부로 지나치게 좁혔으면 reject_too_narrow.\n"
        "- 상위어·지나치게 포괄적이면 reject_too_broad.\n"
        "- 방향이 아예 틀렸으면 reject_wrong.\n"
        "- 판단이 애매하면 ambiguous.\n"
        "\n"
        "# 이 문제의 채점 기준(rubric)\n"
        f"- 대표 정답 소재(canonical): {topic.canonical or '(없음)'}\n"
        f"- accept 예시: {_list(topic.accept)}\n"
        f"- reject_too_narrow 예시: {_list(topic.reject_too_narrow)}\n"
        f"- reject_too_broad 예시: {_list(topic.reject_too_broad)}\n"
        f"- reject_wrong 예시: {_list(topic.reject_wrong)}\n"
        f"- 채점 메모: {topic.note or '(없음)'}\n"
        f"{intro}\n"
        "\n"
        "# 학생이 적은 소재\n"
        f'"{word}"\n'
        "\n"
        "위 학생 단어를 accept | reject_too_narrow | reject_too_broad | reject_wrong | ambiguous 중 정확히 하나로 분류하세요.\n"
        "아래 JSON 객체만 출력하세요. 설명·코드펜스 금지.\n"
        '{"graded":"","reason":""}'
    )


def extract_json(text: str) -> dict:
    """Lenient parse: take the first {...} block. Port of extractJson()."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("JSON을 찾지 못함")
    return json.loads(text[start : end + 1])


async def grade_with_llm(
    word: str, topic: Topic, passage: Optional[str]
) -> Tuple[str, str, str, str]:
    """Call the LLM and classify. Returns (graded, reason, provider, model).

    On unparseable output → ('ambiguous', '', provider, model), matching the Edge
    fn's inner try/catch. Network/other errors propagate to the router's outer
    handler (which mirrors the Edge outer catch).
    """
    use_openai = _provider() != "gateway"
    url = OPENAI_URL if use_openai else GATEWAY_URL
    model = OPENAI_MODEL if use_openai else GATEWAY_MODEL
    provider = "openai" if use_openai else "gateway"
    key = os.environ.get("OPENAI_API_KEY" if use_openai else "GATEWAY_API_KEY")

    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(
            url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key}",
            },
            json={
                "model": model,
                "max_tokens": 300,
                "messages": [
                    {"role": "system", "content": SYSTEM_MSG},
                    {"role": "user", "content": build_prompt(word, topic, passage)},
                ],
            },
        )
        data = res.json()

    content = ""
    try:
        content = data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        content = ""

    graded = "ambiguous"
    reason = ""
    try:
        parsed = extract_json(content)
        graded = parsed.get("graded") if parsed.get("graded") in GRADES else "ambiguous"
        reason = parsed.get("reason") if isinstance(parsed.get("reason"), str) else ""
    except Exception:
        graded = "ambiguous"

    return (graded, reason, provider, model)
