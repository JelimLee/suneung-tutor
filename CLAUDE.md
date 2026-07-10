# CLAUDE_CODE_PLAN.md — 수능 영어 독해 튜터 직접 구축 (Lovable 없이)

> 이 문서를 프로젝트 루트에 두고 Claude Code에서 실행한다.
> 오케스트레이션 모드(Fable): 아래 블록을 CLAUDE.md 또는 세션 시작 지시로 사용.

```
## Fable 오케스트레이션 모드
당신은 오케스트레이터입니다. 코드 작성·수정·테스트·디버깅·리팩터링 같은
실행 작업은 직접 하지 말고, 명확한 지침과 함께 서브에이전트에게 위임하세요.
당신의 역할은 계획·분배·진행 파악·결과 종합·중요한 판단입니다.
라우팅: 무거운 추론·설계·근본원인 분석 -> deep-reasoner(Opus, effort max) /
일반 구현·수정·테스트·디버깅·리뷰 -> 실행 에이전트(Opus로 실행) /
단순 명령 실행·빌드·조회·로그 확인 같은 잡무 -> runner(Haiku).
독립 작업은 병렬로 위임하고 위임 중에도 계속 진행하세요. 단, 1~2개 파일의
사소한 수정·오타·설정/문서 변경·단순 조회는 직접 처리해도 됩니다.
강제 게이트(PreToolUse 훅)가 직접 코드 수정을 턴당 2개 파일로 제한합니다.
차단 메시지를 받으면 재시도하지 말고 즉시 그 작업을 서브에이전트에 위임하세요.
```

## 프로젝트 컨텍스트 (서브에이전트에게 매번 전달할 요약)

- 목표: 수능 영어 독해 튜터 웹앱. 5개 문제 유형(빈칸/순서/삽입/어법/어휘).
  기존 Lovable 앱(binkanmaster)의 빈칸 5화면 플로우를 직접 구현으로 이식하고,
  나머지 4유형은 유형별 전용 절차 화면으로 확장.
- 스택: Vite + React + TypeScript + Tailwind, Supabase(Auth/Postgres+pgvector/Edge Functions).
- 이미 준비된 자산 (이 저장소의 `provided/` 폴더):
  - `schema.sql` — 테이블 + pgvector + RLS 정책 (수정 없이 그대로 적용)
  - `functions/tutor-chat/index.ts` — Claude API Edge Function
  - `migrate_to_pgvector.py` — 교사 청크 업서트
  - `episodes.jsonl`, `subchunks.jsonl` — 리트리벌 코퍼스
- 디자인: rimstudy 톤 (크림 배경 #FDF8F0 계열, 핑크 액센트 필, 세이지 태그).

## 절대 규칙 (모든 서브에이전트 지침에 포함)

1. **teacher_chunks 원문을 클라이언트로 내려보내는 코드 금지.** Edge Function
   응답에는 answer / retrieved_ids / strategy_tags만. schema.sql의 RLS 주석 참조.
2. **API 키는 Edge secrets에만.** 프론트 코드·env·저장소에 ANTHROPIC/OPENAI 키 금지.
3. **schema.sql의 RLS 정책을 "편의상" 완화하지 말 것.** 개발 중 권한 오류가 나면
   정책을 여는 게 아니라 호출 경로(JWT 전달)를 고친다.
4. 학생 학습 화면과 챗 화면의 상태·프롬프트 로직은 컴포넌트를 공유하지 않는다.

## 작업 DAG

### T0. 스캐폴드 — 실행 에이전트
`npm create vite@latest . -- --template react-ts` + Tailwind + react-router.
라우트 뼈대: `/` (문제 선택), `/solve/:problemId` (유형별 플로우), `/chat/:problemId`.
완료 기준: `npm run dev` 부팅, 3개 라우트 렌더.

### T1. Supabase 초기화 — runner → 실행 에이전트
`supabase init` → `supabase link` → `provided/schema.sql` 적용 →
`supabase functions deploy tutor-chat` → secrets 설정(사용자에게 키 요청).
완료 기준: SQL Editor에서 4개 테이블 + match_teacher_chunks 확인.

### T2. Anonymous Auth 래퍼 — 실행 에이전트
앱 부팅 시 `supabase.auth.signInAnonymously()` (기존 세션 있으면 재사용).
완료 기준: 새 탭마다 별도 uid, 새로고침 시 동일 uid 유지.

### T3. 코퍼스 마이그레이션 — runner
`python provided/migrate_to_pgvector.py --episodes ... --subchunks ... --review ...`
완료 기준: 스크립트 말미 RPC 검증 top-3 출력.

### T4. 빈칸 플로우 이식 — deep-reasoner(화면 상태 설계) → 실행 에이전트(구현)
5단계: ①문제 선택 ②사전 독해(소재 1단어 + 서론 유형 통념/주장/배경지식 + 빈칸 문장
먼저 보기) ③문장 극성 연습(문장별 +/−/? 마킹) ④주제 회상(자유 입력 → 모범 주제 대조)
⑤선지 처리(3제거 태그 → 2비교 → 근거 한 줄 → 결과).
각 단계 완료 시 attempts에 {step, payload} insert.
소재 확인은 채점이 아니라 넛지: 정답 아니어도 다음 단계 진행 가능해야 함.
완료 기준: 한 문제를 끝까지 진행하면 attempts에 5행 이상 적재.

### T5. 4유형 전용 절차 화면 — deep-reasoner(절차→UI 매핑) → 실행 에이전트 ×4 병렬
공통 프레임(지문 표시 + 단계 카드 + attempts 로깅)에 유형별 단계만 교체:
- 어법: 밑줄 5곳 → 각각 "받는 요소가 뭔가" X-체크(예: 대동사 did↔be mistaken 불일치)
- 어휘: 글 전체 부호(±) 잡기 → 각 밑줄 단어가 그 부호와 충돌하는지 체크
- 순서: 주어진 글 끝 문장 고정 → (A)(B)(C) 첫 단어·연결사만 먼저 스캔 → 후보 배열
- 삽입: 주어진 문장의 지시어·연결사 분석 → 단절 지점 탐색
완료 기준: 유형 선택 시 해당 절차가 뜨고 attempts 로깅 동작.

### T6. 튜터 챗 화면 — 실행 에이전트
`/chat/:problemId`: 메시지 리스트 + 입력, Edge Function 호출(JWT 헤더 포함),
use_rag 토글(기본 on), 응답의 [전략: ...] 태그는 배지로 분리 표시.
완료 기준: 왕복 1회 성공 + chat_messages 2행 적재 + retrieved_ids 배지 표시.

### T7. RLS 격리 테스트 — 실행 에이전트 (자동화 테스트로 작성)
익명 세션 A/B 생성 → A의 attempts를 B가 select → 0행 검증.
anon 키로 teacher_chunks select → 권한 오류 검증.
완료 기준: 테스트 2건 green. 이 테스트 없이 배포 금지.

### T8. 시드 + 배포 — runner
기존 8문제(2026 3모/6모 31–34) + 신규 유형 문제를 problems에 시드(서비스 키),
Vercel/Netlify 배포, 환경변수는 SUPABASE_URL/ANON_KEY만.

## 병렬화 힌트
T2·T3은 T1 직후 병렬. T4와 T5의 4개 유형은 공통 프레임 완성 후 전부 병렬 위임 가능.
T7은 T4~T6 중 하나라도 끝나면 시작.
