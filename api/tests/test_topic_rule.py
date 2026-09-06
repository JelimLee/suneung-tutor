"""Tier-1 규칙 매처 단위 테스트 — 0토큰, 네트워크 없음.

이 매처는 src/lib/solve/gradeTopic.ts 의 포팅본이다. 두 구현이 어긋나면
같은 학생 입력에 클라이언트와 서버가 다른 판정을 내리므로, 여기 케이스는
TS 주석이 명시한 2-pass 규칙(정확일치는 accept 우선 / 부분일치는 reject 우선)을
그대로 고정한다.

실행: cd api && ./.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from models import Topic  # noqa: E402
from services.topic_rule import hit, match_topic_rule, norm  # noqa: E402


class TestNorm(unittest.TestCase):
    def test_lowercases_and_drops_punctuation_and_space(self):
        self.assertEqual(norm("  Self-Control!! "), "selfcontrol")

    def test_keeps_hangul_and_digits(self):
        self.assertEqual(norm("도덕 관념 2"), "도덕관념2")

    def test_none_and_empty(self):
        self.assertEqual(norm(None), "")
        self.assertEqual(norm(""), "")


class TestHit(unittest.TestCase):
    def test_bidirectional_substring(self):
        self.assertTrue(hit("규칙", "획일적 규칙 적용"))
        self.assertTrue(hit("획일적 규칙 적용", "규칙"))

    def test_min_shared_length_two(self):
        """한 글자짜리는 우연 충돌이 너무 잦아 매칭에서 제외한다."""
        self.assertFalse(hit("규", "규칙"))
        self.assertFalse(hit("규칙", "규"))

    def test_unrelated(self):
        self.assertFalse(hit("날씨", "도덕"))


class TestMatchTopicRule(unittest.TestCase):
    def test_short_word_is_ambiguous_not_reject(self):
        """두 글자 미만은 판정하지 않고 LLM 으로 넘긴다 (틀렸다고 하지 않는다)."""
        graded, matched = match_topic_rule("도", Topic(accept=["도덕"]))
        self.assertEqual(graded, "ambiguous")
        self.assertIsNone(matched)

    def test_exact_accept(self):
        graded, _ = match_topic_rule("도덕", Topic(accept=["도덕", "윤리"]))
        self.assertEqual(graded, "accept")

    def test_canonical_counts_as_accept(self):
        graded, _ = match_topic_rule("도덕", Topic(canonical="도덕", accept=[]))
        self.assertEqual(graded, "accept")

    def test_exact_accept_beats_incidental_substring_reject(self):
        """PASS 1 의 존재 이유. '도덕'이 accept 에 명시돼 있으면,
        reject_wrong 의 '경직된 도덕관' 에 부분포함된다는 이유로 지면 안 된다."""
        topic = Topic(accept=["도덕"], reject_wrong=["경직된 도덕관"])
        graded, _ = match_topic_rule("도덕", topic)
        self.assertEqual(graded, "accept")

    def test_substring_reject_beats_accept(self):
        """PASS 2 의 존재 이유. accept 어디에도 정확히 없는 함정어는
        부분일치만으로도 reject 로 잡혀야 한다."""
        topic = Topic(accept=["규칙의 유연한 적용"], reject_wrong=["획일적 규칙 적용"])
        graded, _ = match_topic_rule("규칙", topic)
        self.assertEqual(graded, "reject_wrong")

    def test_reject_bucket_priority_wrong_broad_narrow(self):
        topic = Topic(reject_wrong=["날씨"], reject_too_broad=["날씨 이야기"])
        graded, _ = match_topic_rule("날씨", topic)
        self.assertEqual(graded, "reject_wrong")

    def test_too_broad_and_too_narrow_are_distinguished(self):
        topic = Topic(canonical="자기조절", reject_too_broad=["학습"],
                      reject_too_narrow=["아침 6시 기상"])
        self.assertEqual(match_topic_rule("학습", topic)[0], "reject_too_broad")
        self.assertEqual(match_topic_rule("아침 6시 기상", topic)[0], "reject_too_narrow")

    def test_no_match_is_ambiguous(self):
        graded, matched = match_topic_rule("우주선", Topic(accept=["도덕"]))
        self.assertEqual(graded, "ambiguous")
        self.assertIsNone(matched)

    def test_empty_rubric_never_crashes(self):
        """루브릭이 비어도 죽지 않고 LLM 폴백으로 넘긴다."""
        self.assertEqual(match_topic_rule("도덕", Topic())[0], "ambiguous")

    def test_normalization_applies_to_rubric_entries_too(self):
        graded, _ = match_topic_rule("self control", Topic(accept=["Self-Control"]))
        self.assertEqual(graded, "accept")


if __name__ == "__main__":
    unittest.main()
