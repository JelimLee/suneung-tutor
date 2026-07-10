#!/usr/bin/env python3
"""
problems 시드 — JSONL → Supabase problems 테이블 (service_role)

problems.jsonl 한 줄 형식:
  {"problem_id": "...", "question_type": "빈칸|순서|삽입|어법|어휘",
   "source": "...", "difficulty": 1-5, "passage": "...", "question": "...",
   "choices": ["...", ...], "answer": 5, "student_question": "..."}

사용:
  export SUPABASE_URL=https://<ref>.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=...
  pip install supabase
  python seed_problems.py --file problems_ebs.jsonl [--dry-run]

주의: problems 테이블의 컬럼(source, difficulty, student_question)이 없으면
      먼저 SQL Editor에서 ALTER로 추가해야 함 (아래 안내 참조).
"""

import argparse, json, os, sys


def load(path):
    return [json.loads(l) for l in open(path, encoding="utf-8")]


def validate(rows):
    ok = True
    valid_types = {"빈칸", "순서", "삽입", "어법", "어휘", "무관"}
    seen = set()
    for r in rows:
        pid = r.get("problem_id", "?")
        if r["question_type"] not in valid_types:
            print(f"  ⚠️ {pid}: 잘못된 유형 {r['question_type']}"); ok = False
        if not (1 <= r.get("answer", 0) <= len(r.get("choices", []))):
            print(f"  ⚠️ {pid}: 정답 번호 {r.get('answer')}가 선지 범위 밖"); ok = False
        if pid in seen:
            print(f"  ⚠️ {pid}: 중복 problem_id"); ok = False
        seen.add(pid)
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rows = load(args.file)
    print(f"{len(rows)}개 문제 로드")
    if not validate(rows):
        sys.exit("검증 실패 — 위 경고 수정 후 재시도")
    print("검증 통과 ✓")

    # DB 레코드로 변환 (choices는 jsonb, answer는 int)
    records = []
    for r in rows:
        rec = {
            "id": r["problem_id"],
            "question_type": r["question_type"],
            "exam_round": r.get("source", ""),
            "passage": r["passage"],
            "question": r.get("question", ""),
            "choices": r["choices"],
            "answer": r["answer"],
            # 아래 컬럼들은 ALTER로 추가돼 있어야 함
            "difficulty": r.get("difficulty"),
            "student_question": r.get("student_question", ""),
            "explanation": r.get("explanation", ""),
        }
        # 삽입 유형 전용 필드. 있을 때만 실어서(비-삽입 파일과의 하위호환) 유지.
        # problems 테이블에 insert_sentence 컬럼(text)이 있어야 함.
        if "insert_sentence" in r:
            rec["insert_sentence"] = r["insert_sentence"]
        records.append(rec)

    if args.dry_run:
        print("\n[dry-run] 업서트 대상:")
        for rec in records:
            print(f"  {rec['id']} ({rec['question_type']}, 난이도 {rec['difficulty']}) "
                  f"정답 {rec['answer']} / {rec['passage'][:40]}...")
        return

    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        assert os.environ.get(k), f"{k} 환경변수 필요"

    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    for i in range(0, len(records), 50):
        sb.table("problems").upsert(records[i:i+50]).execute()
        print(f"  업서트 {min(i+50, len(records))}/{len(records)}")

    # 검증
    res = sb.table("problems").select("id, question_type", count="exact").execute()
    print(f"\n완료 — problems 테이블 총 {res.count}개")


if __name__ == "__main__":
    main()
