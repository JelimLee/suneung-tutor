"""Tier-2 LLM 폴백의 순수 부분 테스트 — 네트워크·API 키 없음.

실제 호출(grade_with_llm)은 httpx 를 모킹해 검사한다. 검증 대상은 두 가지다:
  1. provider/model 은 하드코딩이 아니라 **실제로 호출한 값**이 돌아오는가
     (측정한 provenance 만 기록한다는 원칙)
  2. 모델이 이상한 걸 뱉어도 학생 화면을 막지 않고 ambiguous 로 흘리는가
"""

import asyncio
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from models import Topic  # noqa: E402
from services import llm  # noqa: E402

TOPIC = Topic(canonical="자기조절", accept=["자기통제"],
              reject_too_broad=["학습"], note="방향만 보면 됨")


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


def _fake_client(payload, captured=None):
    """httpx.AsyncClient 를 대체하는 async 컨텍스트 매니저."""

    class _C:
        async def __aenter__(self_inner):
            return self_inner

        async def __aexit__(self_inner, *a):
            return False

        async def post(self_inner, url, headers=None, json=None):
            if captured is not None:
                captured.update(url=url, headers=headers, body=json)
            return _FakeResponse(payload)

    return lambda **kw: _C()


def _content(text):
    return {"choices": [{"message": {"content": text}}]}


class TestProviderSwitch(unittest.TestCase):
    def test_defaults_to_openai_when_unset(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(llm._provider(), "openai")

    def test_empty_string_falls_back_to_openai(self):
        with mock.patch.dict(os.environ, {"LLM_PROVIDER": ""}):
            self.assertEqual(llm._provider(), "openai")

    def test_gateway_selected_explicitly(self):
        with mock.patch.dict(os.environ, {"LLM_PROVIDER": "gateway"}):
            self.assertEqual(llm._provider(), "gateway")


class TestFirstSentence(unittest.TestCase):
    def test_takes_first_sentence_only(self):
        self.assertEqual(
            llm._first_sentence("One thing. Two thing! Three?"), "One thing.")

    def test_collapses_whitespace(self):
        self.assertEqual(llm._first_sentence("  A\n  b   c. D."), "A b c.")

    def test_empty_passage(self):
        self.assertEqual(llm._first_sentence(None), "")
        self.assertEqual(llm._first_sentence(""), "")

    def test_no_terminator_returns_whole_text(self):
        self.assertEqual(llm._first_sentence("no period here"), "no period here")


class TestBuildPrompt(unittest.TestCase):
    def test_carries_every_rubric_bucket_and_the_word(self):
        p = llm.build_prompt("자기통제", TOPIC, None)
        for token in ["자기조절", "자기통제", "학습", "방향만 보면 됨"]:
            self.assertIn(token, p)

    def test_empty_buckets_render_as_placeholder_not_none(self):
        """빈 리스트가 'None' 으로 프롬프트에 새면 모델이 그걸 예시로 읽는다."""
        p = llm.build_prompt("x", Topic(), None)
        self.assertIn("(없음)", p)
        self.assertNotIn("None", p)

    def test_passage_first_sentence_included_only_when_present(self):
        with_p = llm.build_prompt("x", TOPIC, "First one. Second one.")
        self.assertIn("First one.", with_p)
        self.assertIn("지문 첫 문장", with_p)
        self.assertNotIn("Second one.", with_p)
        self.assertNotIn("지문 첫 문장", llm.build_prompt("x", TOPIC, None))

    def test_asks_for_bare_json(self):
        p = llm.build_prompt("x", TOPIC, None)
        self.assertIn("코드펜스 금지", p)
        self.assertIn('{"graded":"","reason":""}', p)


class TestExtractJson(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(llm.extract_json('{"graded":"accept"}')["graded"], "accept")

    def test_ignores_prose_around_the_object(self):
        out = llm.extract_json('네, 채점하겠습니다.\n{"graded":"accept","reason":"ok"}\n감사합니다.')
        self.assertEqual(out["reason"], "ok")

    def test_code_fenced(self):
        self.assertEqual(
            llm.extract_json('```json\n{"graded":"reject_wrong"}\n```')["graded"],
            "reject_wrong")

    def test_raises_without_braces(self):
        with self.assertRaises(ValueError):
            llm.extract_json("채점 불가")


class TestGradeWithLlm(unittest.TestCase):
    def _run(self, payload, env=None, captured=None):
        env = {"OPENAI_API_KEY": "test-key", **(env or {})}
        with mock.patch.dict(os.environ, env, clear=True):
            with mock.patch.object(llm.httpx, "AsyncClient", _fake_client(payload, captured)):
                return asyncio.run(llm.grade_with_llm("자기통제", TOPIC, "A passage."))

    def test_returns_measured_provider_and_model(self):
        graded, reason, provider, model = self._run(
            _content('{"graded":"accept","reason":"방향 맞음"}'))
        self.assertEqual((graded, reason), ("accept", "방향 맞음"))
        self.assertEqual(provider, "openai")
        self.assertEqual(model, llm.OPENAI_MODEL)

    def test_gateway_route_reports_gateway_model_and_url(self):
        captured = {}
        _, _, provider, model = self._run(
            _content('{"graded":"accept","reason":""}'),
            env={"LLM_PROVIDER": "gateway", "GATEWAY_API_KEY": "gk"},
            captured=captured)
        self.assertEqual(provider, "gateway")
        self.assertEqual(model, llm.GATEWAY_MODEL)
        self.assertEqual(captured["url"], llm.GATEWAY_URL)
        self.assertEqual(captured["body"]["model"], llm.GATEWAY_MODEL)

    def test_unknown_grade_label_is_downgraded_to_ambiguous(self):
        """모델이 루브릭 밖의 라벨을 만들어내면 그대로 통과시키지 않는다."""
        graded, _, _, _ = self._run(_content('{"graded":"great","reason":"r"}'))
        self.assertEqual(graded, "ambiguous")

    def test_unparseable_output_is_ambiguous_not_an_error(self):
        graded, reason, provider, _ = self._run(_content("죄송합니다"))
        self.assertEqual(graded, "ambiguous")
        self.assertEqual(reason, "")
        self.assertEqual(provider, "openai")

    def test_malformed_api_envelope_is_ambiguous(self):
        graded, _, _, _ = self._run({"error": {"message": "rate limited"}})
        self.assertEqual(graded, "ambiguous")

    def test_non_string_reason_is_dropped(self):
        _, reason, _, _ = self._run(_content('{"graded":"accept","reason":123}'))
        self.assertEqual(reason, "")


if __name__ == "__main__":
    unittest.main()
