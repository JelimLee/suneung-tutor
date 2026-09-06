"""POST /grade-topic 계약 테스트 — 인증과 LLM 은 모킹, 네트워크 없음.

이 라우터가 지켜야 할 계약은 Edge 함수와의 **응답 바이트 호환**이다.
프론트가 나중에 URL 만 바꿔 끼울 수 있어야 하므로, 상태코드·본문 키·
에러 문구가 어긋나면 안 된다. 특히 마지막 케이스 — 무슨 일이 나든 500 이
아니라 200 + ambiguous 로 떨어져야 한다. 소재 채점은 게이트가 아니라
넛지라서, 채점기 장애가 학생의 다음 단계를 막으면 안 되기 때문이다.
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "anon-test")

from fastapi.testclient import TestClient  # noqa: E402

import routers.grade_topic as router_mod  # noqa: E402
from main import app  # noqa: E402

AUTH = {"Authorization": "Bearer test-token"}
RUBRIC = {
    "canonical": "자기조절",
    "accept": ["자기통제"],
    "reject_wrong": ["날씨"],
    "reject_too_broad": ["학습"],
}


async def _ok_user(_authorization):
    return {"id": "user-1"}


async def _no_user(_authorization):
    return None


def _authed():
    return mock.patch.object(router_mod, "get_user", _ok_user)


class TestHealth(unittest.TestCase):
    def test_health(self):
        with TestClient(app) as c:
            r = c.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"status": "ok"})


class TestAuth(unittest.TestCase):
    def test_missing_or_invalid_token_is_401_plaintext(self):
        with mock.patch.object(router_mod, "get_user", _no_user):
            with TestClient(app) as c:
                r = c.post("/grade-topic", json={"word": "자기통제", "topic": RUBRIC})
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.text, "Unauthorized")


class TestValidation(unittest.TestCase):
    def test_missing_word_is_400_with_edge_error_body(self):
        with _authed(), TestClient(app) as c:
            r = c.post("/grade-topic", json={"topic": RUBRIC}, headers=AUTH)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json(), {"error": "word/topic이 필요합니다."})

    def test_missing_topic_is_400(self):
        with _authed(), TestClient(app) as c:
            r = c.post("/grade-topic", json={"word": "자기통제"}, headers=AUTH)
        self.assertEqual(r.status_code, 400)

    def test_unknown_rubric_keys_do_not_422(self):
        """루브릭에 새 필드가 생겨도 채점이 멈추면 안 된다."""
        topic = {**RUBRIC, "future_field": ["뭔가"]}
        with _authed(), TestClient(app) as c:
            r = c.post("/grade-topic", json={"word": "자기통제", "topic": topic},
                       headers=AUTH)
        self.assertEqual(r.status_code, 200)


class TestTierRouting(unittest.TestCase):
    def test_rule_hit_returns_provider_rule_and_never_calls_the_llm(self):
        """Tier 1 에서 끝나면 토큰 0 — LLM 이 불렸는지로 확인한다."""
        llm = mock.AsyncMock()
        with _authed(), mock.patch.object(router_mod, "grade_with_llm", llm):
            with TestClient(app) as c:
                r = c.post("/grade-topic", json={"word": "자기통제", "topic": RUBRIC},
                           headers=AUTH)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(),
                         {"graded": "accept", "reason": "", "provider": "rule", "model": None})
        llm.assert_not_awaited()

    def test_rule_reject_also_short_circuits(self):
        llm = mock.AsyncMock()
        with _authed(), mock.patch.object(router_mod, "grade_with_llm", llm):
            with TestClient(app) as c:
                r = c.post("/grade-topic", json={"word": "날씨", "topic": RUBRIC},
                           headers=AUTH)
        self.assertEqual(r.json()["graded"], "reject_wrong")
        self.assertEqual(r.json()["provider"], "rule")
        llm.assert_not_awaited()

    def test_ambiguous_falls_through_to_the_llm_with_measured_provenance(self):
        llm = mock.AsyncMock(return_value=("accept", "방향 맞음", "openai", "gpt-4o-mini"))
        with _authed(), mock.patch.object(router_mod, "grade_with_llm", llm):
            with TestClient(app) as c:
                r = c.post("/grade-topic",
                           json={"word": "동기부여", "topic": RUBRIC, "passage": "A passage."},
                           headers=AUTH)
        self.assertEqual(r.json(), {"graded": "accept", "reason": "방향 맞음",
                                    "provider": "openai", "model": "gpt-4o-mini"})
        llm.assert_awaited_once()


class TestFailureIsANudgeNotAGate(unittest.TestCase):
    def test_llm_blowup_still_returns_200_ambiguous(self):
        """채점기가 죽어도 학생은 다음 단계로 갈 수 있어야 한다."""
        llm = mock.AsyncMock(side_effect=RuntimeError("upstream 503"))
        with _authed(), mock.patch.object(router_mod, "grade_with_llm", llm):
            with TestClient(app) as c:
                r = c.post("/grade-topic", json={"word": "동기부여", "topic": RUBRIC},
                           headers=AUTH)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["graded"], "ambiguous")
        self.assertEqual(body["reason"], "")
        self.assertIn("upstream 503", body["error"])


if __name__ == "__main__":
    unittest.main()
