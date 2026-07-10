#!/usr/bin/env python3
"""
Phase 2 — RAG vs no-RAG 쌍 응답 생성 (포트폴리오 트랙)

동일 문제 세트에 대해 두 조건으로 튜터 응답을 생성한다:
  no_rag : 6전략 시스템 프롬프트만
  rag    : + 교사 전사 리트리벌 컨텍스트 (유사 문제 설명 발췌)

⚠️ 이 스크립트는 포트폴리오/제품 트랙 전용.
   교사 전사와 6전략을 의도적으로 섞으므로, 출력물을 창융프 연구의
   AI 독립 조건 데이터로 사용하면 안 된다.

사용:
  export ANTHROPIC_API_KEY=...
  python generate_paired_responses.py --problems problems.jsonl \
      --corpus episodes.jsonl --subchunks subchunks.jsonl \
      --out responses.jsonl [--top-k 3] [--dry-run] [--dummy-embed]

problems.jsonl 한 줄 형식:
  {"problem_id": "...", "question_type": "빈칸|순서|삽입|어법|어휘",
   "passage": "...", "question": "...", "choices": ["...", ...],
   "answer": 5, "student_question": "학생이 실제로 물을 법한 질문"}
"""

import argparse, json, os, sys
from pathlib import Path
import numpy as np

MODEL = "claude-sonnet-4-6"

# ------------------------------------------------- 6전략 시스템 프롬프트 (RAG 슬롯 포함)

SYSTEM_BASE = """당신은 수능 영어 독해 튜터입니다. 학생의 질문에 답할 때 아래 6가지 설명 전략(XAI-ED)을 자율적으로 조합해 사용합니다. 한 응답에 보통 2~3개를 조합합니다.

1. Global — 지문 전체의 논리 흐름(주장→근거→반박→재주장 등)을 개괄.
2. Local — 특정 선지·문장에 대해 "왜 이것이 정답/오답인지"를 해당 부분에 한정해 설명.
3. Feature Relevance — 정답 판단에 결정적인 키워드·접속사·담화 표지를 명시적으로 짚음.
4. Example-based — 유사 유형의 패턴이나 사례를 끌어와 설명.
5. Comparison — 정답과 가장 헷갈리는 오답을 직접 비교해 차이를 부각.
6. Counterfactual — 핵심 요소가 달랐다면 정답이 어떻게 바뀌었을지 가정적으로 설명.

규칙:
- 정답을 바로 알려주지 말고 발문으로 유도. 한 번에 한 가지만 묻기.
- 응답은 300자 이내, 친근한 존댓말.
- 응답 마지막 줄에 자기 태깅: [전략: 사용한 전략명들]"""

RAG_SLOT = """

# 참고 — 인간 교사의 실제 설명 발췌 (유사 문제)
아래는 같은 튜터가 유사한 문제를 실제 수업에서 설명한 전사 발췌입니다.
Example-based 전략의 재료로 활용하되, 그대로 복사하지 말고 현재 문제에 맞게 변형하세요.
발췌 내용이 현재 문제와 안 맞으면 무시해도 됩니다.

{retrieved}"""

# ------------------------------------------------- 임베딩/리트리벌 (노트북과 동일 규약)

def normalize(v):
    return v / (np.linalg.norm(v, axis=1, keepdims=True) + 1e-12)

class E5Embedder:
    name = "intfloat/multilingual-e5-small"
    def __init__(self):
        from sentence_transformers import SentenceTransformer
        self.m = SentenceTransformer(self.name)
    def docs(self, ts):
        return normalize(self.m.encode([f"passage: {t}" for t in ts], batch_size=32).astype("float32"))
    def queries(self, ts):
        return normalize(self.m.encode([f"query: {t}" for t in ts]).astype("float32"))

class DummyEmbedder:
    name = "dummy-hash"
    def _e(self, ts, dim=256):
        M = np.zeros((len(ts), dim), dtype="float32")
        for i, t in enumerate(ts):
            for j in range(len(t) - 2):
                M[i, hash(t[j:j+3]) % dim] += 1
        return normalize(M)
    docs = queries = lambda self, ts: self._e(ts)

def load_jsonl(p):
    return [json.loads(l) for l in open(p, encoding="utf-8")]

def build_units(episodes, subchunks, max_chars=1500):
    by_parent = {}
    for s in subchunks:
        by_parent.setdefault(s["parent_id"], []).append(s)
    units = []
    for ep in episodes:
        if ep["char_len"] <= max_chars or ep["chunk_id"] not in by_parent:
            units.append({"id": ep["chunk_id"], "text": ep["text"],
                          "question_type": ep.get("question_type", "")})
        else:
            for s in sorted(by_parent[ep["chunk_id"]], key=lambda x: x["sub_idx"]):
                units.append({"id": s["chunk_id"], "text": s["text"],
                              "question_type": ep.get("question_type", "")})
    return units

def retrieve(embedder, unit_vecs, units, query, question_type, k):
    """question_type이 태깅돼 있으면 동일 유형 우선, 아니면 전체에서 top-k."""
    qv = embedder.queries([query])
    sims = (unit_vecs @ qv.T).ravel()
    order = np.argsort(-sims)
    typed = [i for i in order if units[i]["question_type"] == question_type]
    pick = (typed + [i for i in order if i not in typed])[:k]
    return [(units[i], float(sims[i])) for i in pick]

# ------------------------------------------------- 생성

def build_messages(problem, retrieved_units):
    choices = "\n".join(f"{i+1}. {c}" for i, c in enumerate(problem.get("choices", [])))
    user = (f"[문제 유형] {problem['question_type']}\n[지문]\n{problem['passage']}\n\n"
            f"[문제] {problem.get('question','')}\n[선지]\n{choices}\n\n"
            f"[학생 질문] {problem['student_question']}")
    system = SYSTEM_BASE
    if retrieved_units is not None:
        blob = "\n\n".join(f"--- 발췌 {u['id']} (유사도 {s:.2f}) ---\n{u['text'][:800]}"
                           for u, s in retrieved_units)
        system += RAG_SLOT.format(retrieved=blob)
    return system, user

def call_claude(system, user):
    import anthropic
    client = anthropic.Anthropic()
    r = client.messages.create(model=MODEL, max_tokens=1024, system=system,
                               messages=[{"role": "user", "content": user}])
    return r.content[0].text

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--problems", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--subchunks", required=True)
    ap.add_argument("--out", default="responses.jsonl")
    ap.add_argument("--top-k", type=int, default=3)
    ap.add_argument("--dry-run", action="store_true", help="API 호출 없이 프롬프트만 출력")
    ap.add_argument("--dummy-embed", action="store_true")
    args = ap.parse_args()

    problems = load_jsonl(args.problems)
    units = build_units(load_jsonl(args.corpus), load_jsonl(args.subchunks))
    emb = DummyEmbedder() if args.dummy_embed else E5Embedder()
    unit_vecs = emb.docs([u["text"] for u in units])
    print(f"코퍼스 유닛 {len(units)}개, 문제 {len(problems)}개, 임베더 {emb.name}")

    if not args.dry_run and not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY 필요 (또는 --dry-run)")

    with open(args.out, "w", encoding="utf-8") as fh:
        for p in problems:
            hits = retrieve(emb, unit_vecs, units, p["student_question"],
                            p["question_type"], args.top_k)
            for condition in ("no_rag", "rag"):
                sysmsg, usermsg = build_messages(p, hits if condition == "rag" else None)
                if args.dry_run:
                    print(f"\n{'='*60}\n{p['problem_id']} / {condition}")
                    print(f"[system {len(sysmsg)}자] ...{sysmsg[-200:] if condition=='rag' else '(6전략 기본)'}")
                    print(f"[retrieved] {[u['id'] for u,_ in hits] if condition=='rag' else '-'}")
                    continue
                resp = call_claude(sysmsg, usermsg)
                fh.write(json.dumps({
                    "problem_id": p["problem_id"], "condition": condition,
                    "question_type": p["question_type"],
                    "student_question": p["student_question"],
                    "retrieved_ids": [u["id"] for u, _ in hits] if condition == "rag" else [],
                    "retrieved_texts": [u["text"] for u, _ in hits] if condition == "rag" else [],
                    "response": resp, "model": MODEL,
                }, ensure_ascii=False) + "\n")
                print(f"{p['problem_id']} / {condition} 완료")

if __name__ == "__main__":
    main()
