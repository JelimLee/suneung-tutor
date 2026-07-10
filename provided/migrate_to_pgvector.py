#!/usr/bin/env python3
"""
teacher_chunks 마이그레이션 — 로컬 코퍼스(JSONL) → Supabase pgvector

임베딩은 Supabase 내장 gte-small(384차원)로 통일 (schema.sql의 vector(384)와 일치).
Edge Function의 질의 임베딩도 동일 gte-small — 코퍼스와 질의는 반드시 같은 모델이어야
리트리벌이 유효하다.

사용:
  export SUPABASE_URL=https://<ref>.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=...   # service key — 절대 클라이언트/저장소에 노출 금지
  pip install sentence-transformers supabase
  python migrate_to_pgvector.py --episodes episodes.jsonl --subchunks subchunks.jsonl \
      [--review review_episodes.csv] [--max-chars 1500]
"""

import argparse, json, os
from pathlib import Path


def load_jsonl(p):
    return [json.loads(l) for l in open(p, encoding="utf-8")]


def build_units(episodes, subchunks, review_csv, max_chars):
    tags = {}
    if review_csv and Path(review_csv).exists():
        import pandas as pd
        rv = pd.read_csv(review_csv, encoding="utf-8-sig")
        qcol = [c for c in rv.columns if c.startswith("question_type")]
        scol = [c for c in rv.columns if c.startswith("strategy_tags")]
        for _, r in rv.iterrows():
            tags[r["chunk_id"]] = {
                "question_type": str(r[qcol[0]]) if qcol and pd.notna(r[qcol[0]]) else "",
                "strategy_tags": str(r[scol[0]]).split() if scol and pd.notna(r[scol[0]]) else [],
            }

    by_parent = {}
    for s in subchunks:
        by_parent.setdefault(s["parent_id"], []).append(s)

    units = []
    for ep in episodes:
        t = tags.get(ep["chunk_id"], {})
        base = {
            "session_id": ep["session_id"], "date": ep["date"] or None,
            "phase": ep["phase"], "problem_refs": ep["problem_refs"],
            "question_type": t.get("question_type", ep.get("question_type", "")),
            "strategy_tags": t.get("strategy_tags", ep.get("strategy_tags", [])),
        }
        if ep["char_len"] <= max_chars or ep["chunk_id"] not in by_parent:
            units.append({"id": ep["chunk_id"], "content": ep["text"], **base})
        else:
            for s in sorted(by_parent[ep["chunk_id"]], key=lambda x: x["sub_idx"]):
                units.append({"id": s["chunk_id"], "content": s["text"], **base})
    return units


_MODEL = None
def embed_gte(texts, batch=32):
    global _MODEL
    if _MODEL is None:
        from sentence_transformers import SentenceTransformer
        _MODEL = SentenceTransformer("Supabase/gte-small")
    out = []
    for i in range(0, len(texts), batch):
        v = _MODEL.encode(texts[i:i + batch], normalize_embeddings=True)
        out.extend(v.tolist())
        print(f"  임베딩 {min(i + batch, len(texts))}/{len(texts)}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--episodes", required=True)
    ap.add_argument("--subchunks", required=True)
    ap.add_argument("--review")
    ap.add_argument("--max-chars", type=int, default=1500)
    args = ap.parse_args()

    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        assert os.environ.get(k), f"{k} 환경변수 필요"

    units = build_units(load_jsonl(args.episodes), load_jsonl(args.subchunks),
                        args.review, args.max_chars)
    print(f"업서트 대상 {len(units)}개 유닛")

    vecs = embed_gte([u["content"] for u in units])
    for u, v in zip(units, vecs):
        u["embedding"] = v

    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    for i in range(0, len(units), 50):
        sb.table("teacher_chunks").upsert(units[i:i + 50]).execute()
        print(f"  업서트 {min(i + 50, len(units))}/{len(units)}")

    # 검증: RPC 왕복 확인
    probe = embed_gte(["빈칸 문장부터 먼저 읽는 이유"])[0]
    res = sb.rpc("match_teacher_chunks",
                 {"query_embedding": probe, "match_count": 3, "filter_type": None}).execute()
    print("\nRPC 검증 top-3:")
    for row in res.data:
        print(f"  ({row['similarity']:.3f}) {row['id']} | {row['content'][:60]}...")


if __name__ == "__main__":
    main()
