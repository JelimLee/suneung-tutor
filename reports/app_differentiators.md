# 수능 영어 독해 튜터앱 — "진짜 특별한 점" 분석

> 근거 원칙: 모든 주장은 실제 코드/DB/rubric/시스템프롬프트에서 확인된 것만. 각 주장에 `파일경로:줄번호 — 함수/식별자` 인용. 코드에서 확인 안 되는 건 **[코드상 미확인]** 표기. 추측·미화 금지.
> 작성 근거: `src/`, `supabase/functions/`, `provided/schema.sql`, repo-root `rubric_*.txt`/`tutor_*_rule.txt`, 정적 코드 분석 + 일부 항목은 라이브 e2e(Playwright) 교차검증.

---

## 1. 교육설계(Pedagogy) — 위저드가 학생에게 *강제*하는 것

### 무엇이 특별한가
6개 유형(빈칸·순서·어법·어휘·삽입·무관)이 "답 고르기"가 아니라 **정해진 사고 절차를 밟아야만 다음으로 넘어가는** 유한상태 위저드로 구현돼 있다. 프레임은 `src/components/solve/wizardFrame.tsx`의 `useWizard` + step별 `canProceed` 게이트.

**(a) 사전 독해 게이팅** — 각 위저드 첫 스텝은 소재/도입유형/부호를 *입력·선택해야* 다음이 열린다.
- `src/components/solve/OmitWizard.tsx:96-100` — `omit_topic` 스텝은 **소재를 틀리게(reject) 잡으면 실제로 잠근다**: `canProceed: (run) => run.phase1.topic.input.trim().length > 0 && run.phase1.topic.graded !== 'reject' && run.phase1.intro.pick !== null`.
- `src/components/solve/InsertWizard.tsx:113-116` — 소재 입력 + 개념 수 + 도입 유형 3개 모두 선택해야 통과.
- `src/components/solve/VocabWizard.tsx:51,78` — 소재 한 줄 → 글 부호(±) 순차 강제.
- `src/components/solve/BlankWizard.tsx:69,114,172` — 서론 유형 선택 / 문장 극성 최소 2개 / 주제 회상 텍스트 강제.
- `src/components/solve/GrammarWizard.tsx:53-71` — 밑줄 전부에 범주 + 범주별 인라인 미시진단을 채워야 "틀린 밑줄 고르기"로 진행.

**(b) "왜?"를 자유서술(fill-in)로 강제** — 추론의 *메커니즘*은 객관식이 아니라 학생이 직접 문장으로 써야 한다.
- 원칙 명문화: `src/components/solve/StepOmitExplain.tsx:52-59` 주석 — *"MUST be a fill-in (textarea), never buttons — the '왜 버튼 못 씀' principle: the mechanism has to come from the student, not a menu."*
- `StepOmitExplain.tsx:116` — 프로젝트 유일 `<textarea>` (라벨 `왜 이 문장이 무관한가요? (내 말로 한 문장)`, `:111-113`).
- 자유서술 근거 스텝: `StepInsertConfirm.tsx:225` `왜 그 자리인지 한 줄로 정리해봐요`, `StepThemeRecall.tsx:101-126` `지문을 다시 보지 말고 기억으로 적어보세요`, 그리고 최종선지 근거 한 줄(`StepChoiceProcess.tsx:234`, `StepVocabChoice.tsx:181`, `StepGrammarChoice.tsx:182`, `StepOrderChoice.tsx:155`).
- 버튼은 *선지 정당화 보조*에만: `src/components/solve/ReasonButtons.tsx:4-8` — 정답 flag를 컴포넌트에 절대 안 넘기고, `stableShuffle`(`:23-39`)로 정답이 항상 첫째로 안 오게 섞음.

**(c) 오답 복구 = "틀렸어 다시"가 아니라 진단 후 되돌림** — 신형 위저드(삽입·무관)는 오답 시 정답을 공개하지 않고, 어디서 어긋났는지 되짚어 재도전시키거나 챗으로 인계한다.
- 삽입: `src/components/solve/StepInsertRecover.tsx:64-75` 서브상태 머신 `5a 재판단 → 5b1 신호 재확인 → 5b2 앞문장 읽고 충족판단 → 만족안함=재선택 / 만족함=튜터 인계`, 라우팅 `:230` `sub: pick === '만족 안 함' ? '5c' : 'handoff'`, 인계 `:353-371` (`/chat/${problemId}` 링크, `handoff_reason:'signal_understanding_gap'`).
- 무관: `src/components/solve/StepOmitRecover.tsx:31-43` — *"DIAGNOSES the wrong pick then REDIRECTS (never '틀렸어 다시')"*, trap 진단 라우팅 `:132-159`, 소재 오독 시 `back_to_topic`(`:100-129`), 2회 실패 시 챗 인계(`HANDOFF_AT=2`, `:176`).
- 정답 근거를 **코드로 계산**해 제시(루브릭 해설 prose는 노출 안 함): `StepOmitConfirm.tsx:190-193` + `src/lib/solve/omit.ts` `reconnectPair` — "(N)를 빼면 (N-1)→(N+1)가 이어져요".

### 왜 특별한가 (일반 앱은 왜 안 하나)
일반 AI 튜터/문제풀이앱은 **정답 여부 + 해설 표시**가 기본값이다. 여기서는 (1) 답을 고르기 *전에* 절차를 강제하고, (2) 추론을 객관식으로 대체하지 않고 자유서술로 뽑아내며, (3) 오답을 "정답 공개"로 닫지 않고 진단→재시도 루프로 연다. 이는 UI 편의성과 상충(마찰이 크다)하는 선택이라, 전환율 최적화형 앱은 통상 하지 않는다.

### 뒷받침 가능한 문헌 (주의: 코드 주석에는 인용 없음 — 아래 §요약 참조)
- 자유서술 강제 ↔ **생성 효과(generation effect)** (Slamecka & Graf, 1978).
- 지문 안 보고 주제 회상 ↔ **인출 연습(retrieval practice)** (Roediger & Karpicke, 2006).
- "정답 공개" 회피 + 절차 되짚기 ↔ **피드백 수준 이론**: self-level 지양, task/process-level 지향 (Hattie & Timperley, 2007; Kluger & DeNisi, 1996).
- *이 매핑은 분석자의 학술적 프레이밍이며, 코드베이스가 해당 문헌을 인용한다는 뜻이 아니다* (§4·요약의 정직성 노트 참조).

---

## 2. 인터랙션 설계 — button vs fill_in을 어디서·왜 가르나

### 무엇이 특별한가
입력 방식이 임의가 아니라 **인지 부하 종류에 맞춰 분리**되고, 그 구분이 로그에 남는다.
- **규칙**: 이산 판단(극성 ±, 맞음/충돌, 기여/의심, anaphor 유형, 슬롯 자연/어색, 신호 만족/불만족) = `<button>`; 생성형 추론(소재 회상, 근거 한 줄, 왜 무관, 자기설명) = `type="text"`/`<textarea>`. (증거: §1(b) + `src/lib/solve/*` Tier-1 그레이더 대응.)
- **input_mode 로깅** (연구 메타):
  - `src/components/solve/OmitWizard.tsx:113` `input_mode:'fill_in'`(소재), `:124` `'button'`(서론유형), `:171` `'button'`(문장 스캔).
  - `src/components/solve/StepOmitConfirm.tsx:79` `'button'`, `StepOmitExplain.tsx:88` `'fill_in'`.
  - `src/components/solve/BlankWizard.tsx:87` `'text'`(빈칸 소재).
  - DB 컬럼: `provided/schema.sql:53` `input_mode text -- 학생 입력 방식 (button / fill_in) — 연구 메타`.
  - 챗 경로: `src/pages/Chat.tsx:182,206` 요청 바디에 `input_mode`; 서버 검증 `supabase/functions/tutor-chat/index.ts:467` `["button","text","quick_reply"].includes(...) ? ... : null`, 삽입 `:619`.
  - 위저드 attempt는 `attempts` 테이블의 자유형 `payload` JSON에 기록: `src/lib/logAttempt.ts:54-62` (전용 컬럼 아님).

### 왜 특별한가
대부분 앱은 "탭 한 번"으로 모든 상호작용을 균질화한다. 여기서는 입력 방식 자체가 **측정 변수**(어떤 사고를 버튼으로 눌렀는지 vs 직접 썼는지)로 설계돼, 나중에 학습 로그 분석 시 이산 선택과 생성적 산출을 구분할 수 있다.

### 정직성 플래그 (§요약에도 재기재)
- **라벨 불일치**: 위저드는 `'fill_in'`(무관)과 `'text'`(빈칸)을 같은 자유서술 의미로 혼용하고, 챗 허용값은 `button/text/quick_reply`뿐이라 챗에 `'fill_in'`이 가면 `null`로 강등됨(`tutor-chat/index.ts:467`). 스키마 주석(`schema.sql:53`)은 "button / fill_in"이라 서버 허용값과도 불일치.
- `'quick_reply'`의 실제 사용처는 **[코드상 미확인]**.

---

## 3. 채점 아키텍처 — 3-tier (규칙 0토큰 / 루브릭 캐시 / LLM 인계)

### 무엇이 특별한가
채점이 단일 LLM 호출이 아니라 **비용·결정성에 따라 3계층**으로 라우팅된다.

**Tier 1 — 규칙 그레이더 (0토큰, 순수 클라이언트)**
`src/lib/solve/*.ts`의 그레이더는 전부 순수함수(네트워크/LLM 호출 없음, grep로 import 확인).
- `src/lib/solve/insert.ts:260` `gradeSlotFit`, `:329` `gradeSignalSatisfies`, `:88` `gradeCuePresence`.
- `src/lib/solve/omit.ts:125` `gradeSentenceRelevance`, `:138` `gradeOmitConfirm`.
- `src/lib/solve/vocab.ts:100` `gradeConflict`, `:72` `gradePassagePolarity`.
- `src/lib/solve/gradePolarity.ts:1-2,14` `gradeMark` — 헤더 주석 *"Client-side 0-token grader ... Deterministic (no LLM)."*
- `src/lib/solve/whyOptions.ts:31` `gradeWhyOption` — `return opt.correct ? 'accepted' : 'reject'`.

**Tier 2 — 루브릭 캐시 규칙 매칭 + 애매할 때만 LLM 폴백**
- `src/lib/solve/gradeTopic.ts:1-4,46,79` `matchTopicRule` — 규칙으로 못 정하면 `graded:'ambiguous'` 반환. 헤더: *"When the rules cannot decide, the caller falls back to the grade-topic Edge Function (LLM)."*
- 분기 지점: `src/components/solve/StepPrereading.tsx:98-116` — `if (ruled.graded !== 'ambiguous') { ... return }`(0토큰) 이후에만 `supabase.functions.invoke('grade-topic', ...)`. 동일 패턴 `src/components/solve/OmitWizard.tsx:58-73`(`if (!res.ambiguous) return ...`).
- 폴백 함수 자체: `supabase/functions/grade-topic/index.ts:3`(헤더 "애매할 때만 호출되는 LLM 폴백"), 실제 호출 `:103`.

**Tier 3 — 생성형 자기설명 (하드채점 안 함, 약하면 챗 인계)**
- `src/lib/solve/omit.ts:146-166` `gradeOmitReason` — *"REFLECTIVE (never gates advancing)"*, `overlap>=1 ? 'accept' : tokens>0 ? 'partial' : 'reject'`. `src/lib/solve/insert.ts:306` `gradeReasoning` 동일.
- 인계: `src/components/solve/StepOmitExplain.tsx:96,181-192` — `weak`면 `<Link to={/chat/${problemId}}>튜터와 이유 다듬기 →`. `grader:'tier3'` 태그(`:85`).

**토큰 관점**: Tier 1은 모델 호출 0. LLM을 실제로 치는 곳은 (i) Tier2 애매 폴백(`grade-topic/index.ts:103`), (ii) Tier3 챗(`tutor-chat/index.ts:600` `callChat`, maxTokens 1024), (iii) 루브릭 *생성*(`generate-rubric/index.ts` `callChat`, maxTokens 4000~6000). **정확한 토큰 수치는 [코드상 미확인]** — `max_tokens` 상한과 호출 유무만 확인됨.

### 왜 특별한가
"모든 채점 = LLM 한 방"이 업계 기본값이다. 그 방식은 비용·지연·비결정성(같은 답 다른 채점)을 유발한다. 여기서는 대부분의 판단이 0토큰 결정적 규칙으로 끝나고, LLM은 *애매한 소재 판정*과 *메커니즘 대화*에만 쓰여, 연구 재현성(같은 입력=같은 채점)과 비용을 동시에 잡는다.

---

## 4. 연구 무결성 — 학생트랙↔연구층 분리, anti-leak, provenance

### 무엇이 특별한가

**(a) anti-leak 가드 `toDisplayRubric`** — 루브릭의 채점 근거·해설 prose가 풀이화면에 *미리* 뜨는 것을 구조적으로 차단.
- `src/lib/solve/rubricDisplay.ts:1-11` — *"reasoning/explanation prose is for GRADING and CHAT guidance only, and must NEVER pre-appear on the solve screen (spoon-feeding)."* — 화이트리스트 방식(나열된 필드만 통과).
- 유형별 제거(예): 삽입 `:107-120`은 `connection_cues/distractor_traps/insertion_sentence/slot_fit/reasoning_keywords`를 전부 `undefined`; 무관 `:130-133`은 `sentence_relevance/why_unrelated/flow_without/trap_sentences` 전부 `undefined`; 어법 `:98-100`은 밑줄을 `{num,word}`로만 노출; `why_options`/`pair_options`의 `correct`는 `:65-72,77-82`에서 강제 `false`로 중화.
- 프레임이 *표시용*과 *채점용*을 분리: `src/components/solve/wizardFrame.tsx:224-227` `displayRubric = toDisplayRubric(problem.grading_rubric)` → 스텝엔 `displayRubric`, 채점 클로저엔 FULL rubric(`src/components/solve/OrderWizard.tsx:48-50` `gradeWhyOption(problem.grading_rubric, ...)`, `src/lib/solve/whyOptions.ts:10-14,31-41`).

**(b) 학생 학습 트랙 ↔ 챗(연구) 층 분리**
- 규칙: `CLAUDE.md:40` "학생 학습 화면과 챗 화면의 상태·프롬프트 로직은 컴포넌트를 공유하지 않는다."
- 실증: `src/pages/Chat.tsx:1-4`는 위저드 컴포넌트를 전혀 import하지 않음(grep 0). 위저드→챗 인계는 라우터 state로만(`Chat.tsx:136-137`). 유일 공유 모듈은 데이터층 `src/lib/useProblem.ts`.

**(c) provenance (model/provider/corpus_role)**
- `supabase/functions/generate-rubric/index.ts:26-27` `ACTUAL_MODEL`/`ACTUAL_PROVIDER`(하드코딩 제거) + 각 루브릭에 `provenance_verified:true`.
- `supabase/functions/tutor-chat/index.ts:614-616` — `corpus_role`는 **오직 `LLM_PROVIDER==='gateway' && usedModel==='claude-sonnet-5'`일 때만 `'research'`**, 그 외 `'pilot'`.
- 스키마 `provided/schema.sql:49-52` (`provider`, `corpus_role check(pilot|research) default pilot`), 백필 `provided/migrate_provenance.sql`.

**(d) teacher_chunks 원문 클라이언트 미전송** — 3중 방어.
- 규칙 `CLAUDE.md:34-35`; RLS 0-정책 잠금 `provided/schema.sql:103,125-129`(정책 0개 + RLS on); 응답은 id만 `supabase/functions/tutor-chat/index.ts:518,630-632`(`retrieved_ids`만, 원문 미포함).

### 왜 특별한가
이 앱은 단순 학습 프로덕트가 아니라 **연구 데이터 수집 장치**로 설계됐다. anti-leak는 "정답 근거를 미리 보여주면 실험이 무효"라는 연구 제약을 코드 레벨 가드로 만든 것이고, corpus_role은 "GPT 파일럿 vs 진짜 Sonnet 수집분"을 자동 분리해 방법론 오염을 막는다. 일반 앱엔 이런 층이 존재할 이유가 없다.

### 정직성 플래그
- `correct_order`와 `connective_keywords`는 `toDisplayRubric`이 **제거하지 않고 유지**(`rubricDisplay.ts:35-36`) — 잠재적 노출 벡터. 단, 이를 렌더하는 스텝 컴포넌트는 확인되지 않음(화면 실노출은 별도 e2e로 확인 필요). 순서 위저드는 `pair_options`(중화)·소거를 쓰지 `correct_order`를 직접 안 씀.
- `signal_check`는 **생성기(`generate-rubric`)가 만들지 않음** — 삽입 v3 루브릭의 `signal_check.satisfies`는 저장 시 결정론 PATCH(`satisfies = slot===answer`)로 세팅됨(§5(d)). 런타임에서 `gradeSignalSatisfies`가 읽어 씀. 생성기 미생성은 **[코드상 확인]**.

---

## 5. 엔지니어링 — RAG, 2모델 게이트웨이, RLS, 결정론 PATCH

### 무엇이 특별한가

**(a) RAG (pgvector)**
- `provided/schema.sql:8`(vector 확장), `:73`(`embedding vector(384)`), `:75-76`(HNSW cosine), `:80-94`(`match_teacher_chunks` RPC, `order by embedding <=> query limit`).
- `provided/migrate_to_pgvector.py:64,67`(gte-small 384차원, `normalize_embeddings=True`), `:100-101`(RPC 검증).
- `supabase/functions/tutor-chat/index.ts:496-524` — `use_rag && lastUser`일 때 gte-small 임베딩 → `match_teacher_chunks(match_count:3)` → 타입필터 후 소프트 폴백(`:512-515`) → id만 부착(`:518`).

**(b) 2모델 게이트웨이 + provider 토글**
- `tutor-chat/index.ts:400-402`(`ALLOWED_MODELS=["gpt-5.1","claude-sonnet-5"]`), `:407-438`(`LLM_PROVIDER` env, `callChat` openai↔gateway 분기). 동일 토글이 `generate-rubric/index.ts:11-56`·`grade-topic/index.ts:16-20`에 일관 적용 → **코드 변경 0으로 provider 원복** 가능.

**(c) RLS 격리 + 배포 게이트 테스트**
- 정책: `provided/schema.sql:108-129` — problems 읽기전용, attempts/chat_messages 본인행만(`auth.uid()=user_id`), update/delete 정책 없음(로그 불변), teacher_chunks 0-정책.
- `tests/rls_isolation.mjs` — 익명 A/B 격리(attempts·chat 0행 교차), teacher_chunks 직접 select 차단 + **RPC 경로 누수 테스트(SECURITY DEFINER 사고 탐지)**, anon insert/update 차단, 전부 green 아니면 배포 non-zero exit(`:110-112`).

**(d) 결정론 PATCH (정답키 유도 필드는 LLM 아닌 코드로 강제)**
- `generate-rubric/index.ts:1153-1162` — 삽입 `slot_fit.fit = (slot === answer)` 강제(fit:true 정확히 1개 == answer 불변식).
- `:1407-1417` — 무관 `sentence_relevance.relevant = (num !== answer)` 강제.
- `:666-674`(어법)·`:905-914`(어휘) `is_correct = (num !== answer)`, `word`는 `choices[i]` ground truth로 강제.
- `:406-434` `normalizeWhySet` — 각 근거 세트 정확히 1개만 `correct:true` 강제(런타임 채점이 flag 조회이므로 불변식 필수).

### 왜 특별한가
스택 자체(Supabase/pgvector/Edge)는 흔하지만, **정답키에서 결정론적으로 유도 가능한 필드를 LLM에 맡기지 않고 코드로 강제**하는 규율은 드물다. 이는 (1) 재생성 비용 0, (2) "정답 슬롯이 정확히 하나" 같은 불변식 보장, (3) 채점 결정성을 준다. RLS의 RPC 누수 테스트까지 배포 게이트로 건 것도 일반 앱 수준을 넘는다.

### 정직성 플래그
- 게이트웨이엔 임베딩 모델이 없어 쿼리 임베딩은 Supabase 내장 gte-small에 의존(`tutor-chat/index.ts:7` 주석). 코퍼스·쿼리 임베딩 모델 일치 규율은 있으나 이 의존은 알아둘 것.

---

## 6. 인간 교사 → 앱 조작화 (핵심 novelty)

대면 과외의 소크라테스식 발문을 **[교사 질문] → [UI 스텝·학생에게 뜨는 텍스트] → [루브릭 필드] → [챗 guidance slot(같은 무브 미러링)]** 4단으로 이식했다. 이 "발문의 코드화"가 이 앱의 가장 독창적인 부분이다.

### F-1. "소재 뭐 잡았어?" (사전 독해)
- 교사룰 원문: `rubric_vocab.txt:7` "소재·서론 유형 판단: ... 주장/배경/통념 중 무엇인지, 글의 소재가 무엇인지"; `tutor_vocab_rule.txt:6` "이 글은 전체적으로 긍정적이에요, 부정적이에요? 소재가 뭐예요?"
- UI: `StepInsertTopic.tsx:132`("도입부만 읽고 한 줄로"), `StepVocabTopic.tsx:71`, `StepPrereading.tsx:101-106`.
- 루브릭 필드: `src/lib/useProblem.ts:73-84` `topic{canonical,accept,reject_*}`, `intro_type`, `theme_keywords`.
- 챗 미러: `tutor-chat/index.ts:267`(VOCAB_GUIDANCE_SLOT "소재가 뭐예요?"), WIZARD_SLOT `:89-90`("소재를 '규칙'이라 했으면 ... '규칙이라고 봤는데 첫 문장 다시 볼까요?'로 시작").

### F-2. "왜 이걸 골랐어?" (근거 자기설명)
- UI: `StepInsertConfirm.tsx:225`, `StepOmitExplain.tsx:112`, 최종선지 근거 한 줄.
- 루브릭: `useProblem.ts:131` `reasoning_keywords`, `:140` `why_unrelated(HIDDEN)`, `:105-108` `why_options`(correct는 FRAME에서만 채점).
- 챗 미러: `tutor-chat/index.ts:153`(ORDER_GUIDANCE_SLOT "왜 B가 먼저 온다고 생각하셨나요?").

### F-3. "이 문장 빼면/넣으면 이어져?" (검증 — "고르고 끝내기" 금지)
- 교사룰: `tutor_insert_omit_rule.txt:3` "답을 고르고 끝내는 것을 절대 허용하지 않는다 ... 넣어보고/빼보고 검증"; `:7` "앞 문장 → 삽입 문장이 자연스럽게 이어지나요?"
- UI: 삽입 5슬롯 순차 O/X(`InsertWizard.tsx:193-216`), 무관 재연결쌍 **코드 계산**(`StepOmitConfirm.tsx:190-193` + `omit.reconnectPair`).
- 루브릭: `useProblem.ts:124-142` `insertion_sentence/slot_fit/signal_check/sentence_relevance/flow_without/trap_sentences`(전부 HIDDEN).
- 챗 미러: `tutor-chat/index.ts:328-334`(INSERT), `:390-394`(OMIT "빼보고 → 앞뒤 연결 → 주제 관련성").

### F-4. "이 밑줄이 뭘 물어봐?" (어법 범주 진단)
- UI: `StepDiagnose`(`GrammarWizard.tsx:36-100`, 범주 + 인라인 미시진단).
- 루브릭: `useProblem.ts:18-37` `GrammarUnderline.category`("GRADING KEY — never rendered") 등 진단필드, `toDisplayRubric`이 렌더 전 제거.
- 챗 미러: `tutor-chat/index.ts:206-213`(GRAMMAR_GUIDANCE_SLOT 범주 되묻기, `:164` "answer/category/... 절대 노출 금지").

### F-5. "정답은 알지만 안 알려주고 되묻기" — anti-leak가 곧 조작화
- 각 챗 slot 헤더 `【선생님만 아는 채점 근거 — 학생에게 절대 직접 말하지 마세요】`(`tutor-chat/index.ts:136,194,253,313,375`).
- 위저드→챗 인계 시 "처음부터 다시 묻지 마라, 막힌 지점을 이어받아라"(WIZARD_SLOT `:82-91`).

### 왜 특별한가
일반 AI 튜터는 프롬프트에 "소크라테스식으로 대화하라"고 *지시*할 뿐이다. 여기서는 (1) 교사의 각 발문이 *특정 UI 스텝*으로 고정되고, (2) 그 발문의 채점 근거가 *구조화된 루브릭 필드*로 존재하며, (3) 같은 발문이 *서버 프롬프트 슬롯*으로 미러링돼 화면과 챗이 동일 교수 논리를 공유한다. 즉 "대화 스타일"이 아니라 **교수 절차의 데이터 모델**이다. rubric_*.txt / tutor_*_rule.txt가 실제 교사 규칙 원문이라는 점이 이 이식의 근거다.

---

## 홍보 문구 재료

> 아래는 위 §1~6에서 코드로 확인된 것만 근거로 함. 효과성(성적 향상) 주장은 §"과장 금지"의 제약을 지킴.

### 학생 대상
- **한 줄**: "정답을 찍는 앱이 아니라, *왜 그런지 네 말로 설명하게* 만드는 튜터."
- 단락 ①: 소재부터 잡고, 문장을 실제로 넣거나 빼보고, 왜 그 자리인지 한 줄로 써야 넘어간다. 버튼만 누르는 풀이가 아니라, 과외 선생님이 옆에서 "왜?"라고 되묻는 절차를 그대로 밟는다.
- 단락 ②: 틀려도 "오답 ✗"으로 끝나지 않는다. 어디서 어긋났는지 되짚어 다시 고르게 하고, 정말 막히면 튜터 챗으로 이어진다. (※ 현재 이 진단형 회복은 삽입·무관 유형에서 완성 — §과장 금지 참조)

### 학부모 대상
- **한 줄**: "정답 공개형 문제집이 아니라, 사고 절차를 강제하는 과외의 코드화."
- 단락 ①: 6개 유형마다 실제 상위권 과외의 발문("소재 뭐야?", "이 문장 빼면 이어져?", "왜 골랐어?")을 화면 절차로 옮겼습니다. 아이가 답을 미리 보고 외우는 걸 구조적으로 막습니다(정답 근거는 화면에 뜨지 않습니다).
- 단락 ②: 대부분의 채점은 서버 비용 없이 즉시 이뤄지고, 애매한 판단에만 AI가 개입합니다.

### 학술/연구 대상
- **한 줄**: "형성평가 루브릭 + anti-leak 표시가드 + provenance 층을 갖춘 연구용 튜터링 인스트루먼트."
- 단락 ①: `toDisplayRubric`(`src/lib/solve/rubricDisplay.ts`)가 채점 근거를 화면에서 구조적으로 격리(화이트리스트)하고, 채점은 프레임 클로저가 FULL 루브릭으로 수행해 학생 화면엔 verdict만 도달합니다.
- 단락 ②: `model/provider/corpus_role` provenance(`generate-rubric`·`tutor-chat`·`schema.sql`)로 파일럿(GPT) vs 연구(진짜 Sonnet) 수집분을 자동 분리 — 방법론 오염을 코드로 방지합니다.
- 단락 ③: 채점 3-tier(규칙 0토큰 / 루브릭 캐시 / LLM 인계)로 재현성과 비용을 동시에 관리합니다.

---

## 과장하면 안 되는 것 (정직성 제약)

**1. 학습 효과는 입증된 바 없다.** 위 특징은 전부 *설계·구현* 근거이지 성적 향상·학습 성과 증거가 아니다. 효과성 데이터는 **[코드상 미확인]**(애초에 코드로 증명될 수 없음).

**2. "정답 안 알려주고 진단한다"는 일부만 참.** 진단형 오답 회복(정답 미공개 + 되짚기 + 챗 인계)은 **삽입·무관 위저드에만** 완성돼 있다. 구형 4유형(빈칸·어법·어휘·순서)의 최종선지 스텝은 여전히 `아쉬워요 ✗` + 오답 시 정답 공개를 쓴다: `StepChoiceProcess.tsx:321,330-337`, `StepGrammarChoice.tsx:78`, `StepVocabChoice.tsx:78`, `StepOrderChoice.tsx:80`. → "앱 전체가 오답을 진단만 한다"는 **과장**.

**3. 소재 오독을 실제로 잠그는 건 무관 위저드뿐.** 나머지는 "입력/선택했는가"만 게이트하고 소재 정오답은 nudge로 흘린다(`OmitWizard.tsx:96-100` vs `BlankWizard.tsx:69`·`InsertWizard.tsx:113-116`). → "모든 유형이 사전독해를 통과해야 진행된다"는 **부분적으로만 참**.

**4. 학습과학 문헌을 코드가 인용하지 않는다.** `generation effect / retrieval practice / Kluger / DeNisi / XAI-ED / Socratic` 등 **코드 주석에 문헌 인용 없음**(grep 0). §1·§요약의 문헌 매핑은 분석자의 외부 프레이밍이며, "코드가 이 이론을 구현한다고 명시"한다고 주장하면 안 됨.

**5. anti-leak에 잔여 벡터.** `correct_order`·`connective_keywords`는 표시 루브릭에서 제거되지 않는다(`rubricDisplay.ts:35-36`). 현재 렌더 컴포넌트는 확인 안 됐지만, "루브릭 내부필드 노출 0"을 무조건 단언하면 안 됨 — DOM 실노출 e2e로만 확정 가능.

**6. table-stakes(자랑거리 아님)**: Supabase Anonymous Auth, CORS 처리, 본인행 RLS select/insert 자체는 표준. *진짜* 특별한 건 teacher_chunks 0-정책 잠금, RPC 누수 테스트, corpus_role 게이팅, 결정론 정답키 정규화.

**7. 인프라 의존/불일치**: provider 토글은 현재 OpenAI(gpt-4o/gpt-4o-mini) 구간 — "Claude Sonnet 단일 모델" 전제는 게이트웨이 복귀 후에만 성립(그때 수집분만 `corpus_role='research'`). `input_mode` 라벨 불일치(`fill_in`/`text`/챗 허용값)도 미해결.

**8. 미확인 항목**: 정확한 토큰/비용 수치, `'quick_reply'` 사용처, CLAUDE.md 내 "pedagogy rule" 원문 위치 — 전부 **[코드상 미확인]**.
