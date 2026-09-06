"""agreement.py 단위 테스트 — 네트워크·API 키 없이 도는 순수 계산 검증.

여기서 지키려는 것은 "일치도 수치를 내가 직접 계산할 줄 안다"가 아니라,
**유병률 역설을 코드가 실제로 드러내는가**다. kappa 하나만 보고했다면
Po=0.95 인 열이 kappa=0.0 으로 보여 "일치가 없다"는 잘못된 결론이 나온다.

실행: python3 -m unittest discover -s tests/python
"""

import csv
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import agreement  # noqa: E402


class TestCohenKappa(unittest.TestCase):
    def test_perfect_agreement_on_mixed_labels(self):
        a = [1, 0, 1, 0]
        k, po = agreement.cohen_kappa(a, list(a))
        self.assertEqual(po, 1.0)
        self.assertAlmostEqual(k, 1.0)

    def test_total_disagreement_is_negative(self):
        k, po = agreement.cohen_kappa([1, 1, 0, 0], [0, 0, 1, 1])
        self.assertEqual(po, 0.0)
        self.assertAlmostEqual(k, -1.0)

    def test_kappa_undefined_when_both_raters_are_constant(self):
        """양쪽 모두 전부 1이면 pe=1 → 분모 0. None 을 돌려주고 죽지 않아야 한다."""
        k, po = agreement.cohen_kappa([1] * 5, [1] * 5)
        self.assertIsNone(k)
        self.assertEqual(po, 1.0)

    def test_prevalence_paradox_is_visible(self):
        """20건 중 19건 일치인데 kappa=0 — 이 상황을 PABAK 이 구해준다."""
        a = [1] * 20
        b = [1] * 19 + [0]
        k, po = agreement.cohen_kappa(a, b)
        self.assertAlmostEqual(po, 0.95)
        self.assertAlmostEqual(k, 0.0)
        self.assertAlmostEqual(agreement.pabak(po), 0.90)

    def test_balanced_case_matches_hand_computation(self):
        a = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
        b = [1, 1, 1, 1, 0, 1, 0, 0, 0, 0]
        k, po = agreement.cohen_kappa(a, b)
        self.assertAlmostEqual(po, 0.8)
        self.assertAlmostEqual(k, 0.6)


class TestPabak(unittest.TestCase):
    def test_endpoints(self):
        self.assertEqual(agreement.pabak(1.0), 1.0)
        self.assertEqual(agreement.pabak(0.5), 0.0)
        self.assertEqual(agreement.pabak(0.0), -1.0)


class TestLoad(unittest.TestCase):
    def _write(self, rows):
        fh = tempfile.NamedTemporaryFile(
            "w", suffix=".csv", delete=False, encoding="utf-8-sig", newline=""
        )
        w = csv.DictWriter(fh, fieldnames=["problem_id", "condition", *agreement.STRATEGIES])
        w.writeheader()
        for r in rows:
            w.writerow(r)
        fh.close()
        self.addCleanup(os.unlink, fh.name)
        return fh.name

    def test_keys_on_problem_id_and_condition(self):
        """같은 문제라도 rag/no_rag 는 별개 행 — 조건이 키에서 빠지면 쌍이 뭉개진다."""
        path = self._write([
            dict(problem_id="p1", condition="rag", GL=1, LO=0, FR=1, EX=0, CM=1, CF=0),
            dict(problem_id="p1", condition="no_rag", GL=0, LO=1, FR=0, EX=1, CM=0, CF=1),
        ])
        rows = agreement.load(path)
        self.assertEqual(set(rows), {("p1", "rag"), ("p1", "no_rag")})
        self.assertEqual(rows[("p1", "rag")]["GL"], 1)
        self.assertEqual(rows[("p1", "no_rag")]["GL"], 0)

    def test_accepts_float_formatted_and_bom_csv(self):
        """엑셀을 거친 CSV는 1 이 "1.0" 으로, 헤더 앞에 BOM 이 붙어 돌아온다."""
        path = self._write([
            dict(problem_id="p2", condition="rag", GL="1.0", LO="0.0",
                 FR="1.0", EX="0.0", CM="1.0", CF="0.0"),
        ])
        rows = agreement.load(path)
        self.assertEqual(rows[("p2", "rag")], {"GL": 1, "LO": 0, "FR": 1, "EX": 0, "CM": 1, "CF": 0})


if __name__ == "__main__":
    unittest.main()
