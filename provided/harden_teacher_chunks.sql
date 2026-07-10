-- harden_teacher_chunks.sql
-- 목적: teacher_chunks(과외 전사 원문, 민감 자산) 클라이언트 차단을 '명시적'으로 못박는다.
--   진단 결과 현재도 안 새고 있음(RLS on + 클라이언트 정책 0개 + RPC는 SECURITY INVOKER).
--   아래는 방어 강화(defense-in-depth): anon 접근을 '0행'이 아니라 '권한오류'로 만들고,
--   RPC를 클라이언트가 호출조차 못 하게 하며, 미래의 실수(정책/ DEFINER 추가)까지 막는다.
-- 실행: Supabase SQL Editor. 전부 멱등(여러 번 실행해도 안전).

-- 1) RLS 확실히 on + 소유자에게도 강제.
--    (service_role 은 BYPASSRLS 라 Edge Function 리트리벌에는 영향 없음)
alter table public.teacher_chunks enable row level security;
alter table public.teacher_chunks force  row level security;

-- 2) 클라이언트 role 의 '테이블 권한' 자체를 회수.
--    → anon/authenticated 가 select 하면 0행이 아니라 42501 권한오류가 난다.
revoke all on table public.teacher_chunks from anon, authenticated;

-- 3) 리트리벌 RPC 를 클라이언트가 호출조차 못 하게. Edge(service_role)만 실행 가능.
revoke all on function public.match_teacher_chunks(vector, int, text) from public, anon, authenticated;
grant execute on function public.match_teacher_chunks(vector, int, text) to service_role;

-- 4) (선택 — Advisors 'function_search_path_mutable' 경고 0 만들기)
--    함수의 search_path 를 고정. public(테이블)+extensions(vector 연산자) 둘 다 포함해 안전.
create or replace function public.match_teacher_chunks(
  query_embedding vector(384),
  match_count     int  default 3,
  filter_type     text default null
)
returns table (id text, content text, question_type text, similarity float)
language sql stable
security invoker              -- 명시(기본값) — 클라이언트가 부르면 RLS 가 그대로 적용됨
set search_path = public, extensions
as $$
  select tc.id, tc.content, tc.question_type,
         1 - (tc.embedding <=> query_embedding) as similarity
  from teacher_chunks tc
  where filter_type is null or tc.question_type = filter_type
  order by tc.embedding <=> query_embedding
  limit match_count;
$$;
-- create or replace 는 기존 권한을 유지하지만, 안전하게 3) 을 이 아래 다시 한 번:
revoke all on function public.match_teacher_chunks(vector, int, text) from public, anon, authenticated;
grant execute on function public.match_teacher_chunks(vector, int, text) to service_role;

-- ── 적용 후 상태 확인용 (결과를 붙여주면 검증) ──
-- a) RLS 상태 (t, t 여야 함):
--    select relrowsecurity, relforcerowsecurity from pg_class where relname='teacher_chunks';
-- b) 클라이언트 정책 개수 (0 이어야 함):
--    select count(*) from pg_policies where tablename='teacher_chunks';
-- c) 함수 실행권한 (anon/authenticated 없어야 함):
--    select grantee, privilege_type from information_schema.routine_privileges
--    where routine_name='match_teacher_chunks';
