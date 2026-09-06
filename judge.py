#!/usr/bin/env python3
"""
Phase 3 — LLM-as-Judge 채점기

responses.jsonl(Phase 2 출력)의 각 응답을 루브릭으로 채점한다.
채점 축 = 창융프 연구 루브릭 4축 + RAG 전용 2축.

  [전략 이행] 6전략 각각 0/1 (GL, LO, FR, EX, CM, CF)
  [품질 4축 — 수행된 전략 전체에 대해 응답 단위로 평가]
    accuracy   0~2 : 0 환각/오류 있음, 1 부분적 부정확, 2 지문 근거 정확
    depth      1~3 : 1 결과 제시, 2 근거 제시, 3 추론 과정 공개
    pedagogy   1~3 : 1 부적절(오개념 위험/수준 불일치), 2 무난, 3 수준 맞춤+오개념 없음
    actionability 0~2 : 0 전이 요소 없음, 1 전략 언급, 2 전이 가능 전략+메타인지 발문
  [RAG 전용 — condition==rag만]
    groundedness      1~3 : 응답이 리트리벌 발췌를 실제로 활용/근거화했는가
    context_relevance 1~3 : 리트리벌된 발췌 자체가 이 문제·질문에 적절했는가

사용:
  export ANTHROPIC_API_KEY=...
  python judge.py --responses responses.jsonl --out judge_scores.csv [--dry-run]

주의: Judge 점수는 인간 코딩과의 kappa/PABAK 검증(agreement.py) 전까지
     신뢰도 미확정 상태로 취급할 것.
"""

import argparse
import csv
import json
import os
import re
import sys
from typing import Any, Dict, List

JUDGE_MODEL = "claude-sonnet-4-6"  # 생성 모델과 동일 — self-preference 편향 가능성을
                                   # 보고서에 한계로 명시하거나, opus로 바꿔 교차 검증

STRATEGIES: List[str] = ["GL", "LO", "FR", "EX", "CM", "CF"]

JUDGE_SYSTEM = """당신은 교육 AI 설명 품질 평가자입니다. 수능 영어 튜터 응답을 아래 루브릭으로 채점하고, 반드시 JSON만 출력하세요 (서문·백틱 금지).

# 전략 이행 (각 0/1)
GL: 지문 전체 논리 흐름 개괄 / LO: 특정 선지·문장 한정 정오 설명 / FR: 키워드·접속사·담화표지 명시 / EX: 유사 패턴·사례 동원 / CM: 선지·개념 직접 비교 / CF: 가정적 시나리오("~였다면 답이 달라짐")

# 품질 (응답 전체 기준)
accuracy: 0 환각·사실 오류 / 1 부분 부정확 / 2 지문 근거 정확
depth: 1 결과만 제시 / 2 근거 제시 / 3 추론 과정 공개
pedagogy: 1 오개념 위험·수준 불일치 / 2 무난 / 3 수준 맞춤·과잉일반화 없음
actionability: 0 전이 요소 없음 / 1 전략 언급 / 2 전이 전략+메타인지 발문

# RAG 전용 (retrieved 발췌가 주어진 경우만, 아니면 null)
groundedness: 1 발췌 미활용·무관 / 2 표면적 참조 / 3 발췌를 실질 근거·사례로 변형 활용
context_relevance: 1 발췌가 문제와 무관 / 2 부분 관련 / 3 문제·질문에 직결

# 출력 형식 (이 JSON 스키마 그대로)
{"GL":0,"LO":0,"FR":0,"EX":0,"CM":0,"CF":0,"accuracy":0,"depth":1,"pedagogy":1,"actionability":0,"groundedness":null,"context_relevance":null,"rationale":"한 문장 근거"}"""


def build_user(rec: Dict[str, Any]) -> str:
    """한 응답 레코드를 Judge용 user 메시지로 조립한다.

    retrieved_texts 가 없으면 groundedness/context_relevance 를 null 로 두라고
    명시한다 — no_rag 조건에 RAG 축 점수가 붙는 오염을 막는 장치.
    """
    parts = [f"[문제 유형] {rec['question_type']}",
             f"[학생 질문] {rec['student_question']}",
             f"[튜터 응답]\n{rec['response']}"]
    if rec.get("retrieved_texts"):
        blob = "\n---\n".join(t[:500] for t in rec["retrieved_texts"])
        parts.append(f"[리트리벌 발췌]\n{blob}")
    else:
        parts.append("[리트리벌 발췌] 없음 (groundedness/context_relevance는 null)")
    return "\n\n".join(parts)


def parse_judge_json(text: str) -> Dict[str, Any]:
    """Judge 원문 출력에서 점수 JSON을 뽑는다.

    루브릭에서 "백틱 금지"라고 지시했지만 모델은 종종 코드펜스를 붙인다.
    파싱 실패로 응답 하나를 통째로 버리는 것보다 펜스를 벗기는 쪽이 낫다.
    호출부와 분리해 둔 것은 이 파싱을 네트워크 없이 테스트하기 위해서다.
    """
    text = re.sub(r"^```(json)?|```$", "", text.strip(), flags=re.M).strip()
    return json.loads(text)


def call_judge(user: str) -> Dict[str, Any]:
    """Judge 모델을 한 번 호출하고 점수 JSON으로 파싱한다."""
    import anthropic
    client = anthropic.Anthropic()
    r = client.messages.create(model=JUDGE_MODEL, max_tokens=512,
                               system=JUDGE_SYSTEM,
                               messages=[{"role": "user", "content": user}])
    return parse_judge_json(r.content[0].text)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--responses", required=True)
    ap.add_argument("--out", default="judge_scores.csv")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with open(args.responses, encoding="utf-8") as fh:
        recs = [json.loads(line) for line in fh if line.strip()]
    if not args.dry_run and not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY 필요 (또는 --dry-run)")

    fields = ["problem_id", "condition", "question_type", *STRATEGIES,
              "accuracy", "depth", "pedagogy", "actionability",
              "groundedness", "context_relevance", "rationale"]
    with open(args.out, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for rec in recs:
            user = build_user(rec)
            if args.dry_run:
                print(f"--- {rec['problem_id']}/{rec['condition']} ---\n{user[:300]}\n")
                continue
            try:
                score = call_judge(user)
            except Exception as e:
                print(f"실패 {rec['problem_id']}/{rec['condition']}: {e}")
                continue
            w.writerow({"problem_id": rec["problem_id"], "condition": rec["condition"],
                        "question_type": rec["question_type"],
                        **{k: score.get(k) for k in fields[3:]}})
            print(f"{rec['problem_id']}/{rec['condition']} 채점 완료")

    print(f"\n저장: {args.out}")
    print("다음 단계: 동일 응답을 직접 코딩한 human_codes.csv를 만들고 agreement.py로 kappa/PABAK 검증")


if __name__ == "__main__":
    main()
