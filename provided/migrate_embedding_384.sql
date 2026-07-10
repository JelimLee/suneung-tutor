-- =====================================================================
-- gte-small(384) 전환 — 라이브 DB 재적용
-- teacher_chunks가 비어 있으므로 임베딩 컬럼을 안전하게 재생성한다.
-- SQL Editor에 붙여넣고 실행.
-- =====================================================================

-- 1) 의존 객체 제거 (인덱스 → 함수)
drop index if exists teacher_chunks_emb_idx;
drop function if exists match_teacher_chunks(vector, integer, text);

-- 2) 임베딩 컬럼을 384차원으로 재생성 (빈 테이블이므로 drop/add가 캐스팅보다 안전)
alter table teacher_chunks drop column if exists embedding;
alter table teacher_chunks add  column embedding vector(384);

-- 3) HNSW 인덱스 재생성
create index teacher_chunks_emb_idx
  on teacher_chunks using hnsw (embedding vector_cosine_ops);

-- 4) 유사도 검색 RPC를 384차원 시그니처로 재생성
create or replace function match_teacher_chunks(
  query_embedding vector(384),
  match_count     int  default 3,
  filter_type     text default null
)
returns table (id text, content text, question_type text, similarity float)
language sql stable
as $$
  select tc.id, tc.content, tc.question_type,
         1 - (tc.embedding <=> query_embedding) as similarity
  from teacher_chunks tc
  where filter_type is null or tc.question_type = filter_type
  order by tc.embedding <=> query_embedding
  limit match_count;
$$;
