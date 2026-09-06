#!/usr/bin/env bash
# 평가 파이프라인 배선 점검 (mock) — 네트워크·API 키 없이 judge → agreement 를 끝까지 돌린다.
#
# ⚠️ 여기서 나오는 kappa/PABAK 수치는 **평가 결과가 아니다.** 가짜 점수라
#    품질과 아무 상관이 없다. 이 스크립트가 확인하는 것은 배선뿐이다:
#      1. responses.jsonl → judge.py 가 스키마대로 CSV 를 쓰는가
#      2. agreement.py 가 그 CSV 를 읽고 전략별 Po/kappa/PABAK 를 내는가
#      3. rag / no_rag 두 조건이 (problem_id, condition) 키로 안 섞이는가
#
# 실제 수치를 내려면:
#   export ANTHROPIC_API_KEY=...
#   python3 generate_paired_responses.py --problems ... --corpus ... --subchunks ...
#   python3 judge.py --responses responses.jsonl --out judge_scores.csv
#   python3 agreement.py --judge judge_scores.csv --human human_codes.csv
#
# 실행: bash scripts/eval_smoke.sh   (또는 make eval-smoke)

set -euo pipefail
cd "$(dirname "$0")/.."

PY=${PYTHON:-python3}
OUT=eval_out                      # .gitignore 됨
PROBLEMS=${PROBLEMS:-problems_sample.jsonl}
mkdir -p "$OUT"

echo "=== 0. 수식 self-test (합성 데이터로 유병률 역설 재현) ==="
$PY agreement.py --self-test

echo
echo "=== 1. problems -> responses (LLM 호출 없음, 자리채움 응답) ==="
$PY - "$PROBLEMS" "$OUT/responses.jsonl" <<'PYEOF'
"""문제 세트를 rag/no_rag 쌍 응답으로 확장한다. 응답 본문은 자리채움이다 —
generate_paired_responses.py 의 출력 '형식'만 재현해 judge.py 를 먹인다."""
import json, sys

src, dst = sys.argv[1], sys.argv[2]
with open(src, encoding="utf-8") as fh:
    problems = [json.loads(l) for l in fh if l.strip()]

n = 0
with open(dst, "w", encoding="utf-8") as out:
    for p in problems:
        for cond in ("no_rag", "rag"):
            rag = cond == "rag"
            out.write(json.dumps({
                "problem_id": p["problem_id"],
                "condition": cond,
                "question_type": p["question_type"],
                "student_question": p["student_question"],
                "retrieved_ids": ["mock_chunk_1"] if rag else [],
                "retrieved_texts": ["(MOCK) 유사 문제 교사 설명 자리채움."] if rag else [],
                "response": f"(MOCK/{cond}) 소재부터 잡아볼까요? [전략: Global, Feature Relevance]",
                "model": "mock",
            }, ensure_ascii=False) + "\n")
            n += 1
print(f"문제 {len(problems)}건 x 2조건 = 응답 {n}건 -> {dst}")
PYEOF

echo
echo "=== 2. judge.py --mock (결정적 가짜 채점) ==="
$PY judge.py --responses "$OUT/responses.jsonl" --out "$OUT/judge_scores.csv" --mock

echo
echo "=== 3. 인간 코딩 자리채움 생성 (judge CSV 를 일부러 흔든 사본) ==="
$PY - "$OUT/judge_scores.csv" "$OUT/human_codes.csv" <<'PYEOF'
"""judge CSV 를 복사하며 마지막 행의 GL 만 뒤집는다. 완전 일치(kappa 정의불능)와
완전 불일치 양극단을 피해, agreement.py 의 출력 경로를 실제로 밟게 하려는 것."""
import csv, sys

src, dst = sys.argv[1], sys.argv[2]
with open(src, encoding="utf-8-sig", newline="") as fh:
    rows = list(csv.DictReader(fh))
    fields = list(rows[0].keys()) if rows else []
if rows:
    rows[-1]["GL"] = 0 if str(rows[-1]["GL"]) == "1" else 1
with open(dst, "w", encoding="utf-8-sig", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=fields)
    w.writeheader()
    w.writerows(rows)
print(f"{len(rows)}행 -> {dst} (마지막 행 GL 만 반전)")
PYEOF

echo
echo "=== 4. agreement.py (Po / kappa / PABAK) ==="
$PY agreement.py --judge "$OUT/judge_scores.csv" --human "$OUT/human_codes.csv"

echo
echo "✅ 배선 정상. 위 수치는 MOCK 이므로 인용 금지 — 산출물은 $OUT/ 에 있습니다."
