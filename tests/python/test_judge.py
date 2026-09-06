"""judge.py 단위 테스트 — LLM 호출 없이 프롬프트 조립과 출력 파싱만 검증.

핵심은 누출(leakage) 통제다: no_rag 조건의 응답에 RAG 축(groundedness /
context_relevance)이 붙으면 두 조건 비교가 성립하지 않는다. build_user 가
발췌 유무를 프롬프트에 명시하는지 여기서 못 박는다.
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import judge  # noqa: E402

RAG_REC = {
    "problem_id": "p1",
    "condition": "rag",
    "question_type": "빈칸",
    "student_question": "뭐부터 읽어요?",
    "response": "먼저 소재부터 잡아볼까요? [전략: Global]",
    "retrieved_texts": ["교사 발췌 하나", "교사 발췌 둘"],
}
NO_RAG_REC = {**RAG_REC, "condition": "no_rag", "retrieved_texts": []}


class TestBuildUser(unittest.TestCase):
    def test_includes_type_question_and_response(self):
        out = judge.build_user(NO_RAG_REC)
        self.assertIn("빈칸", out)
        self.assertIn("뭐부터 읽어요?", out)
        self.assertIn("[전략: Global]", out)

    def test_no_rag_marks_rag_axes_as_null(self):
        """발췌가 없으면 RAG 축을 null 로 두라고 프롬프트가 지시해야 한다."""
        out = judge.build_user(NO_RAG_REC)
        self.assertIn("없음", out)
        self.assertIn("null", out)
        self.assertNotIn("교사 발췌", out)

    def test_rag_embeds_retrieved_excerpts(self):
        out = judge.build_user(RAG_REC)
        self.assertIn("교사 발췌 하나", out)
        self.assertIn("교사 발췌 둘", out)
        self.assertIn("---", out)  # 발췌 구분자

    def test_missing_retrieved_key_behaves_like_no_rag(self):
        rec = {k: v for k, v in RAG_REC.items() if k != "retrieved_texts"}
        self.assertIn("null", judge.build_user(rec))

    def test_long_excerpts_are_truncated(self):
        """발췌 하나가 Judge 프롬프트를 다 잡아먹지 않도록 500자로 자른다."""
        rec = {**RAG_REC, "retrieved_texts": ["가" * 2000]}
        out = judge.build_user(rec)
        self.assertIn("가" * 500, out)
        self.assertNotIn("가" * 501, out)


class TestParseJudgeJson(unittest.TestCase):
    RAW = ('{"GL":1,"LO":0,"FR":1,"EX":0,"CM":1,"CF":0,"accuracy":2,"depth":3,'
           '"pedagogy":3,"actionability":2,"groundedness":null,'
           '"context_relevance":null,"rationale":"근거"}')

    def test_plain_json(self):
        self.assertEqual(judge.parse_judge_json(self.RAW)["accuracy"], 2)

    def test_strips_json_code_fence(self):
        """루브릭에서 백틱을 금지했어도 모델은 붙인다. 그걸로 행을 버리지 않는다."""
        out = judge.parse_judge_json("```json\n" + self.RAW + "\n```")
        self.assertEqual(out["depth"], 3)

    def test_strips_bare_fence_and_whitespace(self):
        out = judge.parse_judge_json("\n```\n" + self.RAW + "\n```\n  ")
        self.assertEqual(out["rationale"], "근거")

    def test_rag_axes_survive_as_none(self):
        out = judge.parse_judge_json(self.RAW)
        self.assertIsNone(out["groundedness"])
        self.assertIsNone(out["context_relevance"])

    def test_unparseable_raises(self):
        """조용히 0점을 만들어내면 안 된다 — 실패는 실패로 올라와야 한다."""
        with self.assertRaises(json.JSONDecodeError):
            judge.parse_judge_json("죄송하지만 채점할 수 없습니다.")


class TestMockJudge(unittest.TestCase):
    """--mock 은 API 키 없이 배선만 점검하는 모드다. 점수 자체엔 의미가 없지만,
    스키마와 조건 분리는 실채점과 똑같이 지켜야 배선 점검이 의미를 가진다."""

    def test_is_deterministic(self):
        u = judge.build_user(RAG_REC)
        self.assertEqual(judge.mock_judge(u), judge.mock_judge(u))

    def test_emits_every_csv_column(self):
        out = judge.mock_judge(judge.build_user(RAG_REC))
        for axis in [*judge.STRATEGIES, "accuracy", "depth", "pedagogy",
                     "actionability", "groundedness", "context_relevance", "rationale"]:
            self.assertIn(axis, out, axis)

    def test_no_rag_gets_null_rag_axes(self):
        """실채점과 같은 누출 통제 — 발췌가 없으면 RAG 축은 null 이어야 한다."""
        out = judge.mock_judge(judge.build_user(NO_RAG_REC))
        self.assertIsNone(out["groundedness"])
        self.assertIsNone(out["context_relevance"])

    def test_rag_gets_scored_rag_axes(self):
        out = judge.mock_judge(judge.build_user(RAG_REC))
        self.assertIn(out["groundedness"], (1, 2, 3))
        self.assertIn(out["context_relevance"], (1, 2, 3))

    def test_scores_stay_inside_the_rubric_ranges(self):
        out = judge.mock_judge(judge.build_user(RAG_REC))
        for s in judge.STRATEGIES:
            self.assertIn(out[s], (0, 1))
        self.assertIn(out["accuracy"], (0, 1, 2))
        self.assertIn(out["depth"], (1, 2, 3))
        self.assertIn(out["pedagogy"], (1, 2, 3))
        self.assertIn(out["actionability"], (0, 1, 2))

    def test_rationale_is_labelled_as_fake(self):
        """CSV 만 보고 실채점으로 착각하는 사고를 막는다."""
        self.assertIn("MOCK", judge.mock_judge(judge.build_user(RAG_REC))["rationale"])


class TestRubricContract(unittest.TestCase):
    def test_six_strategies(self):
        self.assertEqual(judge.STRATEGIES, ["GL", "LO", "FR", "EX", "CM", "CF"])

    def test_system_prompt_declares_every_scored_axis(self):
        """CSV 열과 루브릭 프롬프트가 어긋나면 빈 열이 조용히 생긴다."""
        for axis in [*judge.STRATEGIES, "accuracy", "depth", "pedagogy",
                     "actionability", "groundedness", "context_relevance"]:
            self.assertIn(axis, judge.JUDGE_SYSTEM, axis)


if __name__ == "__main__":
    unittest.main()
