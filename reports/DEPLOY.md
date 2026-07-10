# DEPLOY.md — 수능 영어 독해 튜터 배포 가이드 (T8)

배포 준비 문서. **비밀 값은 이 문서에 없습니다** — 이름/위치/용도만 기재.
실제 키 입력·Vercel/Netlify 설정·Supabase 대시보드 작업은 사용자가 직접 수행합니다.

- Supabase 프로젝트 ref (live): `azcqqriftbwqljimvkuu`
- Frontend: Vite + React + react-router-dom (SPA)
- Backend: Supabase (Auth / Postgres+pgvector / Edge Functions)

---

## 1. 환경변수 이름 목록 (NAMES ONLY — 값 없음)

코드에서 실제로 참조하는 이름만 추출했습니다.
(`src/`의 `import.meta.env.VITE_*`, `supabase/functions/**`의 `Deno.env.get(...)`)

### 1-A. 프론트엔드 빌드타임 (Vercel / Netlify 대시보드에 설정)

| 이름 | 설정 위치 | 용도 |
|---|---|---|
| `VITE_SUPABASE_URL` | Vercel/Netlify env (Build & Runtime) | Supabase 프로젝트 REST/Auth 엔드포인트 URL |
| `VITE_SUPABASE_ANON_KEY` | Vercel/Netlify env (Build & Runtime) | 클라이언트용 anon 공개 키 (RLS로 보호됨; 프론트에 노출 가능한 유일한 Supabase 키) |

> 주의: `VITE_` 접두사 변수는 빌드 시 번들에 인라인됩니다. 여기에는 **anon 키만** 넣습니다.
> service_role 키는 절대 프론트 env에 넣지 않습니다.

### 1-B. Supabase Edge Function secrets (`supabase secrets set` 로 설정)

대상 함수: `tutor-chat`, `grade-topic`, `generate-rubric` (셋 다 동일한 이름 참조).

| 이름 | 설정 위치 | 용도 | 사용자가 직접 설정? |
|---|---|---|---|
| `LLM_PROVIDER` | `supabase secrets set` | LLM 경로 선택. 미설정 시 코드 기본값 `"openai"`. 값은 `"openai"` 또는 `"gateway"` | 선택 (기본 openai) |
| `OPENAI_API_KEY` | `supabase secrets set` | `LLM_PROVIDER=openai`일 때 OpenAI 직속 호출 키 | 예 (openai 경로 시 필수) |
| `GATEWAY_API_KEY` | `supabase secrets set` | `LLM_PROVIDER=gateway`일 때 게이트웨이(mindlogic) 호출 키 | 예 (gateway 경로 시 필수) |
| `SUPABASE_URL` | 자동 주입 | Edge 함수가 자체 프로젝트 REST 호출용. **Supabase가 자동 제공** | 아니오 (자동) |
| `SUPABASE_ANON_KEY` | 자동 주입 | 사용자 JWT 검증/RLS 경유 클라이언트 생성용. **자동 제공** | 아니오 (자동) |
| `SUPABASE_SERVICE_ROLE_KEY` | 자동 주입 | teacher_chunks 리트리벌 등 RLS 우회 서버 작업용. **자동 제공** | 아니오 (자동) |

> 모델명·게이트웨이 base URL은 함수 코드에 **상수로 하드코딩**되어 있어 env가 아닙니다
> (예: `DEFAULT_MODEL`, `OPENAI_MODEL`, `RUBRIC_MODEL`, `GATEWAY_MODEL`). 별도 설정 불필요.
> `SUPABASE_*` 3개는 Supabase Edge 런타임이 자동 주입하므로 `secrets set` 대상이 아닙니다
> (수동 설정 대상은 `OPENAI_API_KEY` / `GATEWAY_API_KEY` / 선택적 `LLM_PROVIDER` 뿐).

### 1-C. 시드 스크립트 런타임 (로컬 일회성 실행 — 로컬 셸 export)

| 이름 | 설정 위치 | 용도 |
|---|---|---|
| `SUPABASE_URL` | 로컬 셸 `export` | 시드 대상 프로젝트 URL (예: `https://<ref>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | 로컬 셸 `export` | `problems` 테이블 upsert용 service_role 키 (RLS 우회). **커밋 금지** |

---

## 2. 빌드 / 배포 설정

### 빌드
- **Build command**: `npm run build`  (= `tsc -b && vite build`, from `package.json`)
- **Output directory**: `dist`  (Vite 기본; `vite.config.ts`에 override 없음)
- **Framework preset**: **Vite**
- **빌드 검증 결과**: `npm run build` 실행 성공 →
  `dist/index.html`, `dist/assets/index-*.js` (~618 kB, gzip ~164 kB),
  `dist/assets/index-*.css` (~24 kB) 생성 확인.
  경고는 chunk size(>500 kB) 뿐 — 비치명적. 빌드 에러 없음.

### SPA 라우팅 (필수)
앱은 react-router 클라이언트 라우팅을 사용합니다: `/`, `/solve/:problemId`, `/chat/:problemId`.
새로고침·딥링크 시 서버가 존재하지 않는 경로로 404를 내지 않도록 **index.html 리라이트**가 필요합니다.

**Vercel** — 리포 루트에 `vercel.json`:
```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

**Netlify** — `public/_redirects` (빌드 시 `dist/_redirects`로 복사됨):
```
/*    /index.html   200
```

---

## 3. 배포 시퀀스 (high-level)

1. **(a) 프론트 env 설정** — 호스트(Vercel/Netlify) 대시보드에 `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY` 입력 (§1-A). Framework=Vite, Build=`npm run build`, Output=`dist`.
2. **(b) Edge Functions 배포** — `supabase functions deploy tutor-chat`,
   `supabase functions deploy grade-topic`, `supabase functions deploy generate-rubric`.
   현재 상태: live 프로젝트에는 이 3개 함수가 이미 배포되어 동작 중
   (이전 세션에서 배포·검증 완료). 신규/타겟 프로젝트라면 3개 모두 다시 배포.
3. **(c) Edge secrets 설정** — `supabase secrets set OPENAI_API_KEY=... GATEWAY_API_KEY=... LLM_PROVIDER=...`
   (§1-B; SUPABASE_* 3개는 자동 주입이라 제외). 값은 사용자가 직접 입력.
4. **(d) 시드 실행** — 타겟 프로젝트에 대해:
   ```bash
   export SUPABASE_URL=https://<target-ref>.supabase.co
   export SUPABASE_SERVICE_ROLE_KEY=<service_role_key>   # 로컬 셸에만, 커밋 금지
   node scripts/seed_problems.mjs
   ```
   `scripts/seed_problems.json`(35행)을 `Prefer: resolution=merge-duplicates`로 upsert.
   멱등 — 재실행 안전. 행별 ok/fail + 합계 출력.
   (스키마 자체는 `provided/schema.sql`을 SQL Editor로 먼저 적용. teacher_chunks 코퍼스는
   별도 `provided/migrate_to_pgvector.py`로 마이그레이션 — 이 시드 범위 밖.)
5. **(e) 프론트 배포** — 호스트에서 배포 트리거 (git push 또는 `vercel --prod` / `netlify deploy --prod`).

---

## 4. 안전 (보안 주의)

- **`.env` / service_role 키를 절대 커밋하지 않습니다.** `.gitignore`에 `.env` 포함 확인.
- **anon 키가 프론트 env에 들어가는 유일한 Supabase 키**입니다. service_role 키는
  Edge(자동 주입)와 로컬 시드 실행(셸 export)에서만 사용.
- `teacher_chunks`(민감 강의 전사)는 시드/export 대상이 아닙니다 — RLS + Edge를 통해서만 접근.
- `grading_rubric`은 앱 콘텐츠라 시드 파일에 포함되지만, RLS/Edge를 통해서만 서빙되고
  클라이언트로 원문이 직접 나가지 않습니다.
- Edge secret은 `supabase secrets set`으로만 설정하고 프론트 코드/env/리포에 두지 않습니다.

---

## 5. 산출물 경로

- 시드 데이터: `scripts/seed_problems.json` (35행, live DB와 개수 일치)
- 시드 스크립트: `scripts/seed_problems.mjs` (Node, global fetch, env 필수, 멱등)
- 이 문서: `reports/DEPLOY.md`
