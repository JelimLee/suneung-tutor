-- ---------------------------------------------------------------------
-- model provenance 수정 (2026-07-09): chat_messages에 provider/corpus_role 추가
-- + 기존 로그 전부 pilot로 백필. DDL이라 SQL Editor(또는 psql)에서 실행.
-- ---------------------------------------------------------------------

-- 1) 컬럼 추가 (idempotent)
alter table chat_messages add column if not exists provider text;
alter table chat_messages add column if not exists corpus_role text
  check (corpus_role in ('pilot','research')) default 'pilot';

-- 2) 기존 로그 백필: 현재까지 수집분은 전부 기능테스트/파일럿 (진짜 sonnet 연구수집 아님)
update chat_messages set corpus_role = 'pilot' where corpus_role is null;

-- 3) provider 백필: model 태그로 역산 (model 필드는 이미 실측값)
update chat_messages set provider = case
  when model in ('gpt-4o','gpt-4o-mini') then 'openai'
  when model in ('gpt-5.1','claude-sonnet-5') then 'gateway'
  else null
end
where provider is null;

-- 확인용:
-- select provider, model, corpus_role, count(*) from chat_messages group by 1,2,3 order by 1,2;
