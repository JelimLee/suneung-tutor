#!/usr/bin/env python3
"""
Judge ↔ 인간 코딩 일치도 분석 — Cohen's kappa + PABAK + 원일치율

입력: 두 CSV. 공통 키 (problem_id, condition), 전략 열 GL LO FR EX CM CF (0/1).
  --judge judge_scores.csv   (judge.py 출력)
  --human human_codes.csv    (동일 형식으로 직접 코딩)

kappa 유병률 역설 대응: 대부분이 1(또는 0)로 코딩된 전략은 우연 일치 기대치가
높아져 원일치율이 높아도 kappa가 붕괴한다. PABAK(=2·Po−1)을 병기해
"불일치가 실제로 얼마나 있었는가"를 함께 보고한다.

사용: python agreement.py --judge judge_scores.csv --human human_codes.csv
      python agreement.py --self-test   # 합성 데이터로 수식·역설 검증
"""

import argparse
import csv
from typing import Dict, List, Optional, Tuple

STRATEGIES = ["GL", "LO", "FR", "EX", "CM", "CF"]


def cohen_kappa(a: List[int], b: List[int]) -> Tuple[Optional[float], float]:
    """이진 레이블 두 열의 (kappa, Po). 양쪽이 전부 같은 값이면 kappa는 None."""
    n = len(a)
    po = sum(1 for x, y in zip(a, b) if x == y) / n
    pa1, pb1 = sum(a) / n, sum(b) / n
    pe = pa1 * pb1 + (1 - pa1) * (1 - pb1)
    if pe == 1.0:
        return None, po  # 양쪽 모두 단일 값 → kappa 정의 불능
    return (po - pe) / (1 - pe), po


def pabak(po: float) -> float:
    """Prevalence-Adjusted Bias-Adjusted Kappa. 유병률이 극단이어도 붕괴하지 않는다."""
    return 2 * po - 1


def load(path: str) -> Dict[Tuple[str, str], Dict[str, int]]:
    """CSV를 {(problem_id, condition): {전략: 0|1}} 로 읽는다."""
    rows: Dict[Tuple[str, str], Dict[str, int]] = {}
    with open(path, encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            key = (r["problem_id"], r["condition"])
            rows[key] = {s: int(float(r[s])) for s in STRATEGIES}
    return rows


def report(
    judge: Dict[Tuple[str, str], Dict[str, int]],
    human: Dict[Tuple[str, str], Dict[str, int]],
) -> None:
    """전략별 + pooled 로 Po·kappa·PABAK 을 출력한다."""
    keys = sorted(set(judge) & set(human))
    if not keys:
        print("공통 키 없음 — problem_id/condition 열 확인")
        return
    print(f"공통 응답 {len(keys)}건\n")
    print(f"{'전략':4s} {'Po(원일치)':>10s} {'kappa':>8s} {'PABAK':>8s}  유병률(judge/human)")
    all_j, all_h = [], []
    for s in STRATEGIES:
        a = [judge[k][s] for k in keys]
        b = [human[k][s] for k in keys]
        all_j += a; all_h += b
        k, po = cohen_kappa(a, b)
        kstr = f"{k:8.3f}" if k is not None else "   정의불능"
        print(f"{s:4s} {po:10.3f} {kstr} {pabak(po):8.3f}  {sum(a)/len(a):.2f}/{sum(b)/len(b):.2f}")
    k, po = cohen_kappa(all_j, all_h)
    kstr = f"{k:.3f}" if k is not None else "정의불능"
    print(f"\n전체 pooled: Po={po:.3f}, kappa={kstr}, PABAK={pabak(po):.3f}")
    print("\n해석: kappa가 낮은데 PABAK이 높으면 유병률 역설 — 실제 불일치는 적음.")
    print("      둘 다 낮으면 Judge 루브릭·프롬프트를 수정하고 재검증할 것.")


def self_test() -> None:
    """유병률 역설 재현: 20건 중 19건이 1로 일치, 1건만 불일치."""
    a = [1]*19 + [1]
    b = [1]*19 + [0]
    k, po = cohen_kappa(a, b)
    print(f"[역설 예시] Po={po:.3f} (95% 일치), kappa={k:.3f}, PABAK={pabak(po):.3f}")
    assert abs(po-0.95)<1e-9 and abs(pabak(po)-0.9)<1e-9 and abs(k)<1e-9, "수식 오류"
    # 균형 잡힌 케이스
    a = [1,1,1,1,1,0,0,0,0,0]
    b = [1,1,1,1,0,1,0,0,0,0]
    k, po = cohen_kappa(a, b)
    print(f"[균형 예시] Po={po:.3f}, kappa={k:.3f}, PABAK={pabak(po):.3f}")
    assert abs(k - 0.6) < 1e-9, "수식 오류"
    print("self-test 통과 ✓")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--judge")
    ap.add_argument("--human")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        self_test()
    else:
        report(load(args.judge), load(args.human))
