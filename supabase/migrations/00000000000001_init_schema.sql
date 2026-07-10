-- =====================================================================
-- 수능 영어 독해 튜터 (포트폴리오 트랙) — Supabase 스키마
-- 설계 원칙: RLS를 자동 생성에 맡기지 않고 직접 작성한다.
--   (Lovable 자동 정책의 과다 허용 문제를 보안 스캔으로 겪은 경험이 근거)
-- 적용: supabase db push 또는 SQL Editor에서 실행
-- =====================================================================

create extension if not exists vector;

-- ---------------------------------------------------------------------
-- 1. problems — 문제 은행 (5유형: 빈칸/순서/삽입/어법/어휘)
-- ---------------------------------------------------------------------
create table if not exists problems (
  id           text primary key,                      -- 예: 2026_3모_31
  question_type text not null check (question_type in ('빈칸','순서','삽입','어법','어휘')),
  exam_round   text,                                  -- 예: 2026_3모
  passage      text not null,
  question     text,
  choices      jsonb not null default '[]',
  answer       int,
  created_at   timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 2. attempts — 학생 학습 플로우 로그 (화면 단계별 입력)
-- ---------------------------------------------------------------------
create table if not exists attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id),
  problem_id  text not null references problems(id),
  step        text not null,        -- prereading | polarity | theme_recall | choice_process | result
  payload     jsonb not null default '{}',
  created_at  timestamptz default now()
);
create index if not exists attempts_user_idx on attempts(user_id, created_at);

-- ---------------------------------------------------------------------
-- 3. chat_messages — 튜터 챗 로그 (RAG 조건·리트리벌 메타 포함)
-- ---------------------------------------------------------------------
create table if not exists chat_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id),
  problem_id    text references problems(id),
  role          text not null check (role in ('user','assistant')),
  content       text not null,
  condition     text check (condition in ('no_rag','rag')),
  retrieved_ids text[] default '{}',   -- 교사 청크 id만 저장 (원문은 저장·노출 금지)
  strategy_tags text[] default '{}',   -- 응답 자기 태깅 파싱 결과
  model         text,                  -- 실험 조건: 응답 생성 모델 (gpt-5.1 / claude-sonnet-5)
  created_at    timestamptz default now()
);
create index if not exists chat_user_idx on chat_messages(user_id, created_at);

-- ---------------------------------------------------------------------
-- 4. teacher_chunks — 교사 전사 리트리벌 코퍼스 (연구 자산)
--    임베딩: Supabase 내장 gte-small (384차원). 챗 게이트웨이에 임베딩 모델이 없어 통일.
--    * 코퍼스(migrate)와 질의(Edge Function) 모두 gte-small로 임베딩해야 함
--      (코퍼스와 질의는 반드시 같은 모델 — 다르면 리트리벌이 무의미해짐)
-- ---------------------------------------------------------------------
create table if not exists teacher_chunks (
  id            text primary key,          -- parse_transcripts.py의 chunk_id
  session_id    text not null,
  date          date,
  phase         text check (phase in ('pre_app','post_app')),
  question_type text default '',
  strategy_tags text[] default '{}',
  problem_refs  int[] default '{}',
  content       text not null,
  embedding     vector(384)
);
create index if not exists teacher_chunks_emb_idx
  on teacher_chunks using hnsw (embedding vector_cosine_ops);
-- ^ FAISS HNSW와 동일 계열의 근사 인덱스. 코퍼스가 수백 규모면 사실상 정확 검색과 동일.

-- 유사도 검색 RPC (Edge Function에서 service_role로만 호출)
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

-- =====================================================================
-- RLS — 테이블마다 명시적으로. "정책이 없으면 접근 불가"가 기본값이 되도록
--       모든 테이블에서 RLS를 켠다.
-- =====================================================================
alter table problems       enable row level security;
alter table attempts       enable row level security;
alter table chat_messages  enable row level security;
alter table teacher_chunks enable row level security;

-- problems: 누구나 읽기(익명 포함), 쓰기는 service_role만.
--   근거: 문제는 공개 콘텐츠. insert/update 정책을 만들지 않음으로써
--   클라이언트발 변조를 차단 (시드는 service key로만).
create policy problems_read on problems
  for select to anon, authenticated using (true);

-- attempts: 본인 행만 읽기/쓰기. Anonymous Auth의 auth.uid() 기준.
--   근거: localStorage UUID 방식은 위조 가능했음 → auth.uid()는 토큰 검증됨.
create policy attempts_insert_own on attempts
  for insert to authenticated with check (auth.uid() = user_id);
create policy attempts_select_own on attempts
  for select to authenticated using (auth.uid() = user_id);
-- update/delete 정책 없음 = 학습 로그 불변 (연구 데이터 무결성).

-- chat_messages: attempts와 동일 원칙.
create policy chat_insert_own on chat_messages
  for insert to authenticated with check (auth.uid() = user_id);
create policy chat_select_own on chat_messages
  for select to authenticated using (auth.uid() = user_id);

-- teacher_chunks: 클라이언트 정책을 하나도 만들지 않는다.
--   근거: 과외 전사 원문은 학생 개인 발화가 포함된 민감 자산.
--   리트리벌은 Edge Function(service_role, RLS 우회)에서만 수행하고,
--   클라이언트에는 생성된 응답과 청크 id만 내려보낸다. 원문은 절대 노출 금지.
--   (정책 0개 + RLS on = anon/authenticated 전면 차단)

-- =====================================================================
-- 검증 체크리스트 (배포 후 반드시):
--  1) 익명 세션 A로 attempts 삽입 → 세션 B에서 select 시 0행인지
--  2) 클라이언트에서 teacher_chunks select 시도 → 권한 오류인지
--  3) Supabase 보안 스캔(Advisors) 재실행 → 경고 0인지
-- =====================================================================
