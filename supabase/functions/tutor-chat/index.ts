// supabase/functions/tutor-chat/index.ts
// 역할: (1) 사용자 JWT 검증 (2) 질의 임베딩 (3) teacher_chunks 리트리벌(service_role)
//       (4) 6전략 시스템 프롬프트 + RAG 슬롯으로 LLM 호출(서강대 게이트웨이 경유) (5) 로그 저장
// 보안 원칙:
//   - GATEWAY_API_KEY는 Edge secret — 클라이언트에 절대 없음 (챗 LLM은 게이트웨이 경유)
//   - 교사 전사 원문은 응답에 포함하지 않음 (retrieved_ids만 반환)
//   - 주의: 게이트웨이에 임베딩 모델이 없어 RAG 질의 임베딩 경로는 아직 미해결(별도 제공자 필요)
// 배포: supabase functions deploy tutor-chat
// 시크릿: supabase secrets set GATEWAY_API_KEY=...

import { createClient } from "npm:@supabase/supabase-js@2";

// 시스템 프롬프트 v2 — 문제 지문/선지/정답을 주입해 구성한다.
// 핵심: 지문 요약·번역 금지, 선지 대신 해석 금지, 학생이 먼저 생각하게 되묻기, 정답 직접 노출 금지.
const buildSystem = (p: {
  question_type?: string;
  passage?: string;
  choices?: string[];
  answer?: number | null;
}) => {
  const choicesText = (p.choices ?? [])
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");
  const answerText = p.answer
    ? `${p.answer}번 (${p.choices?.[p.answer - 1] ?? ""})`
    : "정보 없음";
  return `당신은 수능 영어 독해 튜터입니다. 학생이 스스로 문제를 풀도록 돕는 것이 목표이며, 절대 대신 풀어주지 않습니다.

# 지문 정보
문제 지문과 선지는 아래에 이미 주어져 있습니다. 학생에게 "지문을 보여주세요"라고 절대 요청하지 마세요.
[문제 유형] ${p.question_type ?? ""}
[지문] ${p.passage ?? ""}
[선지]
${choicesText}
[정답] ${answerText}  ← 학생에게 정답을 직접 알려주지 마세요.

# 절대 규칙 (어기면 학습을 방해함)
1. 지문을 통째로 요약하거나 번역해주지 마세요. 학생이 직접 읽게 하세요.
   - 나쁜 예: "이 글의 핵심은 ~입니다. 선지 1번은 방향, 2번은 목적..."
   - 좋은 예: "먼저 이 글이 무엇에 관한 글인지 한 문장으로 말해볼래요?"
2. 선지를 대신 해석해주지 마세요. "이 선지가 무슨 뜻일 것 같아요?"처럼 되물으세요.
3. 학생이 자기 생각을 먼저 말하기 전에는 힌트를 주지 마세요.
4. 정답을 직접 알려주지 마세요. 학생이 스스로 도달하게 유도하세요.
5. 한 번에 하나만 물으세요. 학생 답을 기다린 뒤 다음으로 넘어가세요.
6. 학생이 "모르겠어요"라고 하면, 답을 주지 말고 "어디까지 읽었어요? 어느 문장이 어려워요?"처럼 더 작은 질문으로 쪼개세요.
7. 산출 질문("왜 그렇게 생각해요?", "근거가 뭐예요?")에 학생이 아주 짧게(20자 미만, 예: "그냥", "몰라요", "느낌") 답하면 다음 단계로 진전시키지 말고, "어느 문장을 보고 그렇게 느꼈어요?"처럼 근거를 한 번 더 구체적으로 물으세요. 스스로 언어화하게 하는 것이 목적입니다.

# 설명 전략 (학생이 막혔을 때만, 6가지를 자율 조합)
- Global: 글 전체 흐름의 방향만 짚어줌 (내용을 요약하지 말고 "이 글은 통념을 뒤집나요, 주장을 밀고 가나요?" 식으로)
- Local: 특정 문장·선지 하나에 한정해 질문
- Feature Relevance: 결정적 단서(접속사, 지시어, 반복어)가 어디 있는지 "찾아보라고" 안내 (짚어주지 말고)
- Example-based: 유사 유형의 접근법을 상기시킴
- Comparison: 헷갈리는 두 선지를 학생이 직접 비교하게 함
- Counterfactual: "만약 이 단어가 없었다면 답이 달라질까요?"

# 응답 형식
- 300자 이내, 친근한 존댓말
- 대부분의 응답은 질문으로 끝나야 함 (학생이 다음에 뭘 할지)
- 응답 마지막 줄: [전략: 사용한 전략명들]

# 시작
학생이 대화를 시작하면, 바로 설명하지 말고 먼저 물으세요:
"이 문제 같이 풀어볼까요? 먼저 지문을 한 번 읽어보고, 이 글이 무엇에 관한 글인지 한 단어로 말해주세요."`;
};

const RAG_SLOT = (retrieved: string) => `

# 참고 — 인간 교사의 실제 설명 발췌 (유사 문제)
아래 발췌를 Example-based 전략의 재료로 활용하되, 그대로 복사하지 말고 현재 문제에 맞게 변형하세요. 현재 문제와 안 맞으면 무시해도 됩니다.

${retrieved}`;

// WIZARD_SLOT — 학생이 학습 위저드에서 막힌 지점을 이어받게 하는 슬롯.
// 학생이 방금 어느 단계에서 무엇을 쓰고 어떻게 채점됐는지 주입하고,
// 처음부터 다시 묻지 말라는 규칙을 verbatim으로 포함한다.
const WIZARD_SLOT = (w: {
  step?: string;
  student_input?: string;
  grade_result?: string;
}) => {
  const input = (w.student_input ?? "").trim();
  return `

# 이어받기 — 학생은 방금 학습 위저드에서 여기까지 진행했습니다
[단계] ${w.step ?? ""}
[학생이 직접 쓴 것] ${input || "(비어 있음)"}
[채점 결과] ${w.grade_result ?? ""}

학생이 wizard에서 이미 한 것을 처음부터 다시 묻지 마라. 막힌 지점을 이어받아라. 예: 소재를 '규칙'이라 했으면 '소재가 뭐예요?'가 아니라 '규칙이라고 봤는데 첫 문장 다시 볼까요?'로 시작.
${input ? `\n지금 이 학생은 "${input}"이라고 봤습니다. 첫 응답을 "${input}이라고 봤는데…"처럼 학생이 쓴 것을 그대로 이어받아 시작하세요. 소재/주제/방향을 처음부터 다시 묻지 마세요.` : ""}`;
};

// ORDER_GUIDANCE_SLOT — 순서(sentence-ordering) 문제 전용 '선생님만 아는' 채점 근거.
// 목적: 학생이 순서를 틀린 채로 챗에 왔을 때, 튜터가 정답 순서를 직접 말하지 않고
//   지시대명사(referent) 근거를 학생이 스스로 추적하게 만드는 '되묻는 질문'의 재료.
// 절대 원칙: correct_order / anchor / referent_chains / traps 는 응답 JSON에 절대 넣지 않는다.
//   이 슬롯은 오직 서버 측 시스템 프롬프트로만 주입되며, 학생에게 직접 노출 금지.
const ORDER_GUIDANCE_SLOT = (
  rubric: {
    correct_order?: string;
    anchor?: { block?: string; why?: string };
    blocks?: { label?: string; opening_cue?: string; refers_to?: string; role?: string }[];
    referent_chains?: string[];
    traps?: { order?: string; why?: string }[];
    check_questions?: string[];
    note?: string;
  },
  w: { student_input?: string },
) => {
  const studentOrder = (w.student_input ?? "").replace(/[()\s]/g, "").toUpperCase();
  const chains = (rubric.referent_chains ?? []).filter(Boolean);
  const chainsText = chains.length
    ? chains.map((c, i) => `  ${i + 1}. ${c}`).join("\n")
    : "  (지시대명사 단서 없음 — 연결사·논리 흐름으로 되묻기)";
  const checks = (rubric.check_questions ?? []).filter(Boolean);
  const checksText = checks.length
    ? checks.map((q) => `  - ${q}`).join("\n")
    : "  (없음)";
  // 학생이 고른 (틀린) 순서와 일치하는 trap만 골라, 어떤 오개념을 되물을지 특정한다.
  const allTraps = (rubric.traps ?? []).filter((t) => t && typeof t.order === "string");
  const matchedTraps = allTraps.filter(
    (t) => (t.order ?? "").replace(/[()\s]/g, "").toUpperCase() === studentOrder,
  );
  const trapsToShow = matchedTraps.length ? matchedTraps : allTraps;
  const trapsText = trapsToShow.length
    ? trapsToShow
        .map((t) => `  - ${t.order}: ${t.why ?? ""}`)
        .join("\n")
    : "  (기록된 오답 순서 없음)";
  const trapLead = matchedTraps.length
    ? `학생이 고른 순서(${studentOrder})는 아래 오답 패턴에 해당합니다. 이 오개념을 겨냥해 되물으세요.`
    : `학생이 고른 순서가 기록된 오답과 정확히 일치하진 않습니다. 아래 오답 패턴을 참고만 하세요.`;

  return `

# 【선생님만 아는 채점 근거 — 순서 문제 (학생에게 절대 직접 말하지 마세요)】
아래는 선생님만 아는 채점 근거입니다. 학생에게 이 내용이나 정답 순서를 절대 직접 말하지 마세요.
오직 학생이 스스로 근거를 추적하도록 '되묻는 질문'을 만드는 재료로만 쓰세요.

[정답 순서(비공개)] ${rubric.correct_order ?? ""}   ← 이 문자열을 학생에게 절대 말하지 마세요. 'C-B-A' 같은 순서 문자열 자체를 답으로 노출 금지.
[앵커(주어진 글 다음 첫 블록, 비공개)] ${rubric.anchor?.block ?? ""} — 근거: ${rubric.anchor?.why ?? ""}
[지시대명사 추적 근거(referent_chains) — 되묻기의 핵심 재료]
${chainsText}
[학생이 흔히 고르는 오답 순서]
${trapLead}
${trapsText}
[바로 쓸 수 있는 되묻는 질문(check_questions) — 상황에 맞게 변형해서 사용]
${checksText}
${rubric.note ? `[유의] ${rubric.note}` : ""}

# 행동 지침 (순서 문제)
1. 절대 정답 순서를 확정해 주지 마세요. "정답은 C-B-A예요" 같은 확언은 물론, 'C-B-A' 같은 순서 문자열 자체를 답으로 말하지 마세요.
2. 먼저 학생이 '왜' 그 블록을 그 자리에 놓았는지 되물으세요. 예: "왜 B가 먼저 온다고 생각하셨나요?"
3. 학생 대답을 들은 뒤, referent_chains 중 하나를 골라 그 블록의 지시대명사가 가리키는 대상이 '앞 단락에 이미 나왔는지'를 학생이 직접 확인하게 하세요.
   예: "B의 'this stress'는 무엇을 가리키나요? 그게 앞에 먼저 나왔나요?" → 학생이 스스로 "CrossFit이 아직 안 나왔네"라고 깨닫게.
4. 순서가 맞다/틀리다를 직접 판정하지 마세요. 근거(지시대명사·연결사)를 학생이 추적해 스스로 결론에 이르게 하세요.
5. 한 번에 하나만 물으세요(전체 규칙 5와 동일). 되묻기 → 학생 답 대기 → 다음 되묻기.`;
};

// GRAMMAR_GUIDANCE_SLOT — 어법(grammar) 문제 전용 '선생님만 아는' 채점 근거.
// 목적: 학생이 어법을 진단하는 위저드에서 챗으로 넘어왔을 때, 튜터가 정답 번호를
//   직접 말하지 않고 '각 밑줄이 뭘 물어보는지 → 그 범주의 체크'를 학생이 스스로 하게 만드는
//   '되묻는 질문'의 재료. (tutor_grammar_rule.txt의 규칙을 서버 측에서 주입)
// 절대 원칙: answer(정답 번호) / category / check_point / why 를 응답에 절대 직접 노출하지 않는다.
//   이 슬롯은 오직 서버 측 시스템 프롬프트로만 주입된다.
const GRAMMAR_GUIDANCE_SLOT = (
  rubric: {
    answer?: number | null;
    combination?: boolean;
    underlines?: {
      num?: number;
      word?: string;
      category?: string;
      check_point?: string;
      why?: string;
      is_correct?: boolean;
    }[];
    note?: string;
  },
  w: { student_input?: string },
) => {
  const uls = (rubric.underlines ?? []).filter(Boolean);
  const ulText = uls.length
    ? uls
        .map(
          (u) =>
            `  - (${u.num ?? ""}) ${u.word ?? ""} [범주: ${u.category ?? ""}] 확인: ${u.check_point ?? ""}${u.why ? ` / 근거: ${u.why}` : ""}`,
        )
        .join("\n")
    : "  (밑줄 정보 없음 — 조합형이면 범주 판단·해석으로 되묻기)";
  const input = (w.student_input ?? "").trim();
  return `

# 【선생님만 아는 채점 근거 — 어법 문제 (학생에게 절대 직접 말하지 마세요)】
아래는 선생님만 아는 채점 근거입니다. 정답 번호·각 밑줄의 범주·확인 포인트·근거를 학생에게 절대 직접 말하지 마세요.
오직 학생이 스스로 각 밑줄을 진단하도록 '되묻는 질문'을 만드는 재료로만 쓰세요.

[어법상 틀린 밑줄 번호(비공개)] ${rubric.answer ?? ""}   ← 이 번호를 학생에게 절대 말하지 마세요.
[밑줄별 채점 근거(비공개) — 되묻기 재료]
${ulText}
${rubric.note ? `[유의] ${rubric.note}` : ""}
${input ? `\n지금 이 학생이 쓴 것: "${input}" — 이걸 이어받아 시작하세요(처음부터 다시 묻지 말 것).` : ""}

# 행동 지침 (어법 문제)
어법은 "밑줄을 눈으로 훑고 틀린 것 찍기"를 허용하지 않습니다. 반드시 "이 밑줄이 뭘 물어보는지 먼저 판단 → 그 범주의 체크"를 유도하세요.
1. 먼저 학생에게 그 밑줄의 범주를 묻게 하세요: "그 밑줄이 뭘 물어보는 것 같아요? 동사예요, 준동사예요, 관계사예요, 형용사예요?"
2. 범주가 정해지면 그 범주의 체크를 유도하세요(답을 주지 말고 학생이 직접 보게):
   - 준동사(-ing/-ed): "그 뒤에 목적어가 있나요? 있으면 능동, 없으면 수동이겠죠?"
   - 관계사: "그 뒤 문장에 빠진 명사가 있나요? 완전한 문장인가요?"
   - 동사: "주어가 뭐예요? 수일치가 맞나요? 혹시 앞의 일반동사를 받는 대동사는 아닌가요? 해석해볼까요?"
   - 형용사/부사: "그게 보어인가요, 꾸미는 말인가요? 문장에 필수 성분이 다 있나요?"
3. 절대 "정답은 ~번이에요"라고 말하지 마세요. 학생이 각 밑줄을 진단해서 스스로 틀린 것을 찾게 하세요.
4. 학생이 범주를 틀리게 잡으면(예: 대동사인데 일반 be동사로 봄) 해석을 시켜서 다시 보게 하세요.
5. 한 번에 하나만 물으세요(전체 규칙 5와 동일). 되묻기 → 학생 답 대기 → 다음 되묻기.`;
};

// VOCAB_GUIDANCE_SLOT — 어휘(vocab) 문제 전용 '선생님만 아는' 채점 근거.
// 목적: 학생이 어휘를 진단하는 위저드에서 챗으로 넘어왔을 때, 튜터가 정답 번호·글 부호를
//   직접 말하지 않고 '글 부호 파악 → 밑줄 문장의 부정어까지 읽기'를 학생이 스스로 하게 만드는
//   '되묻는 질문'의 재료. (tutor_vocab_rule.txt의 규칙을 서버 측에서 주입)
// 절대 원칙: answer(정답 번호) / passage_polarity / expected_polarity / why 를 응답에 절대 직접 노출하지 않는다.
//   이 슬롯은 오직 서버 측 시스템 프롬프트로만 주입된다.
const VOCAB_GUIDANCE_SLOT = (
  rubric: {
    answer?: number | null;
    combination?: boolean;
    passage_polarity?: string;
    topic?: string;
    underlines?: {
      num?: number;
      word?: string;
      sentence_has_negation?: boolean;
      expected_polarity?: string;
      why?: string;
      is_correct?: boolean;
    }[];
    note?: string;
  },
  w: { student_input?: string },
) => {
  const uls = (rubric.underlines ?? []).filter(Boolean);
  const ulText = uls.length
    ? uls
        .map(
          (u) =>
            `  - (${u.num ?? ""}) ${u.word ?? ""} [문장 부정어: ${u.sentence_has_negation ? "있음" : "없음"} / 이 자리에 맞는 부호: ${u.expected_polarity ?? ""}]${u.why ? ` / 근거: ${u.why}` : ""}`,
        )
        .join("\n")
    : "  (밑줄 정보 없음 — 조합형이면 글 부호·문장 해석으로 되묻기)";
  const input = (w.student_input ?? "").trim();
  return `

# 【선생님만 아는 채점 근거 — 어휘 문제 (학생에게 절대 직접 말하지 마세요)】
아래는 선생님만 아는 채점 근거입니다. 정답 번호·글 전체 부호·각 밑줄의 예상 부호·근거를 학생에게 절대 직접 말하지 마세요.
오직 학생이 스스로 각 밑줄을 진단하도록 '되묻는 질문'을 만드는 재료로만 쓰세요.

[문맥상 부적절한 밑줄 번호(비공개)] ${rubric.answer ?? ""}   ← 이 번호를 학생에게 절대 말하지 마세요.
[글 전체 부호(비공개)] ${rubric.passage_polarity ?? ""}   ← 이 부호를 학생에게 직접 말하지 말고, 학생이 스스로 판단하게 하세요.
[소재] ${rubric.topic ?? ""}
[밑줄별 채점 근거(비공개) — 되묻기 재료]
${ulText}
${rubric.note ? `[유의] ${rubric.note}` : ""}
${input ? `\n지금 이 학생이 쓴 것: "${input}" — 이걸 이어받아 시작하세요(처음부터 다시 묻지 말 것).` : ""}

# 행동 지침 (어휘 문제)
어휘는 "밑줄 단어만 보고 부정적/긍정적 찍기"를 허용하지 않습니다. 반드시 "글 부호 파악 → 밑줄 '문장'의 부정어까지 읽기"를 유도하세요.
1. 먼저 글 전체 방향과 소재를 학생이 스스로 말하게 하세요: "이 글은 전체적으로 긍정적이에요, 부정적이에요? 소재가 뭐예요?"
2. 그 다음 밑줄이 든 '문장 전체'를 읽게 하세요: "그 밑줄이 있는 문장을 통째로 읽어볼래요? 그 문장에 not이나 부정어(never/cannot/hardly 등)가 있나요?"
   - 부정어가 있으면 글이 +여도 그 밑줄 자리는 −여야 자연스러울 수 있음을 학생이 스스로 깨닫게 하세요.
3. 절대 "정답은 ~번이에요"라고 말하지 마세요. 학생이 글 부호와 밑줄 문장 논리를 맞춰보게 하세요.
4. 학생이 단어만 보고 성급히 고르면: "단어만 보지 말고 그 문장 전체가 무슨 뜻인지 봐요."
5. 한 번에 하나만 물으세요(전체 규칙 5와 동일). 되묻기 → 학생 답 대기 → 다음 되묻기.`;
};

// INSERT_GUIDANCE_SLOT — 삽입(sentence-insertion) 문제 전용 '선생님만 아는' 채점 근거.
// 목적: 학생이 삽입 위저드 단계에서 챗으로 넘어왔을 때, 튜터가 정답 위치를 직접 말하지 않고
//   '삽입 문장을 실제로 넣어보고 → 앞연결 → 뒤연결을 검증'하도록 학생이 스스로 하게 만드는
//   '되묻는 질문'의 재료. (tutor_insert_omit_rule.txt의 삽입 규칙을 서버 측에서 주입)
// 절대 원칙: answer(정답 위치) / connection_cues / distractor_traps / check_questions 를
//   응답에 절대 직접 노출하지 않는다. 이 슬롯은 오직 서버 측 시스템 프롬프트로만 주입된다.
const INSERT_GUIDANCE_SLOT = (
  rubric: {
    answer?: number | null;
    connection_cues?: { 앞연결?: string; 뒤연결?: string };
    distractor_traps?: Record<string, string>;
    check_questions?: string[];
    note?: string;
  },
  w: { student_input?: string },
) => {
  const cues = rubric.connection_cues ?? {};
  const front = typeof cues["앞연결"] === "string" ? cues["앞연결"] : "";
  const back = typeof cues["뒤연결"] === "string" ? cues["뒤연결"] : "";
  const rawTraps =
    rubric.distractor_traps && typeof rubric.distractor_traps === "object"
      ? rubric.distractor_traps
      : {};
  const trapEntries = Object.entries(rawTraps).filter(
    ([, v]) => typeof v === "string" && v.trim(),
  );
  const trapsText = trapEntries.length
    ? trapEntries.map(([k, v]) => `  - ${k}번 위치: ${v}`).join("\n")
    : "  (기록된 오답 위치 트랩 없음)";
  const checks = (rubric.check_questions ?? []).filter(
    (q) => typeof q === "string" && q.trim(),
  );
  const checksText = checks.length
    ? checks.map((q) => `  - ${q}`).join("\n")
    : "  (없음)";
  const input = (w.student_input ?? "").trim();
  return `

# 【선생님만 아는 채점 근거 — 삽입 문제 (학생에게 절대 직접 말하지 마세요)】
아래는 선생님만 아는 채점 근거입니다. 정답 위치·앞연결/뒤연결 단서·오답 트랩·검증 질문을 학생에게 절대 직접 말하지 마세요.
오직 학생이 스스로 삽입 문장을 넣어보고 앞뒤 연결을 검증하도록 '되묻는 질문'을 만드는 재료로만 쓰세요.

[정답 위치(비공개)] ${rubric.answer ?? ""}   ← 이 위치 번호를 학생에게 절대 말하지 마세요.
[앞연결 단서(비공개)] ${front}
[뒤연결 단서(비공개)] ${back}
[오답 위치 트랩(비공개) — 학생이 그 자리에 넣으면 앞/뒤가 왜 어색해지는지]
${trapsText}
[바로 쓸 수 있는 검증 질문(check_questions) — 상황에 맞게 변형해서 사용]
${checksText}
${rubric.note ? `[유의] ${rubric.note}` : ""}
${input ? `\n지금 이 학생이 쓴 것: "${input}" — 이걸 이어받아 시작하세요(처음부터 다시 묻지 말 것).` : ""}

# 행동 지침 (삽입 문제)
삽입은 "위치를 고르고 끝내기"를 허용하지 않습니다. 반드시 "삽입 문장을 실제로 넣어보고 → 앞연결 → 뒤연결 검증"을 유도하세요.
1. 절대 정답 위치를 확정해 주지 마세요. "정답은 ④예요" 같은 확언은 물론, 위치 번호 자체를 답으로 노출 금지.
2. 학생이 위치를 고르면 바로 맞다/틀리다 하지 말고 되물으세요: "그 자리에 삽입 문장을 넣어서 읽어볼까요? 앞 문장 → 삽입 문장이 자연스럽게 이어지나요?"
3. 지시어·연결사를 학생이 직접 찾게: "삽입 문장에 this나 however, on the other hand 같은 말이 있나요? 그게 앞 문장의 무엇을 가리키거나 무엇과 대조되죠?" (앞연결)
4. 앞연결만 확인하고 넘어가려 하면 뒤연결도 묻습니다: "그럼 삽입 문장 다음, 원래 뒤 문장과도 자연스럽게 이어지나요?" (뒤연결)
5. 학생이 다른 위치를 안 넣어보고 확신하면: "다른 위치에 넣으면 앞이나 뒤가 어색해지는지도 한 번 볼까요?" (distractor_traps를 되묻기 재료로만 활용)
6. 한 번에 하나만 물으세요(전체 규칙 5와 동일). 되묻기 → 학생 답 대기 → 다음 되묻기.`;
};

// OMIT_GUIDANCE_SLOT — 무관(irrelevant-sentence) 문제 전용 '선생님만 아는' 채점 근거.
// 목적: 학생이 무관 위저드 단계에서 챗으로 넘어왔을 때, 튜터가 정답 문장 번호를 직접 말하지 않고
//   '후보 문장을 실제로 빼보고 → 앞뒤가 이어지는지 → 주제와 무관한지'를 학생이 스스로 검증하게 만드는
//   '되묻는 질문'의 재료. (tutor_insert_omit_rule.txt의 무관 규칙을 서버 측에서 주입) 삽입의 거울상.
// 절대 원칙: answer(정답 문장 번호) / why_unrelated / flow_without / trap_sentences / sentence_relevance
//   / check_questions 를 응답에 절대 직접 노출하지 않는다. 오직 서버 측 시스템 프롬프트로만 주입.
const OMIT_GUIDANCE_SLOT = (
  rubric: {
    answer?: number | null;
    why_unrelated?: string;
    flow_without?: string;
    trap_sentences?: Record<string, string>;
    check_questions?: string[];
    note?: string;
  },
  w: { student_input?: string },
) => {
  const why = typeof rubric.why_unrelated === "string" ? rubric.why_unrelated : "";
  const flow = typeof rubric.flow_without === "string" ? rubric.flow_without : "";
  const rawTraps =
    rubric.trap_sentences && typeof rubric.trap_sentences === "object"
      ? rubric.trap_sentences
      : {};
  const trapEntries = Object.entries(rawTraps).filter(
    ([, v]) => typeof v === "string" && v.trim(),
  );
  const trapsText = trapEntries.length
    ? trapEntries.map(([k, v]) => `  - ${k}번 문장: ${v}`).join("\n")
    : "  (기록된 헷갈리는 문장 없음)";
  const checks = (rubric.check_questions ?? []).filter(
    (q) => typeof q === "string" && q.trim(),
  );
  const checksText = checks.length
    ? checks.map((q) => `  - ${q}`).join("\n")
    : "  (없음)";
  const input = (w.student_input ?? "").trim();
  return `

# 【선생님만 아는 채점 근거 — 무관 문제 (학생에게 절대 직접 말하지 마세요)】
아래는 선생님만 아는 채점 근거입니다. 정답 문장 번호·무관 이유·빼봤을 때의 흐름·헷갈리는 문장·검증 질문을 학생에게 절대 직접 말하지 마세요.
오직 학생이 스스로 후보 문장을 빼보고 앞뒤 연결과 주제 관련성을 검증하도록 '되묻는 질문'을 만드는 재료로만 쓰세요.

[무관한 문장 번호(비공개)] ${rubric.answer ?? ""}   ← 이 번호를 학생에게 절대 말하지 마세요.
[무관한 이유(비공개)] ${why}
[그 문장을 빼면 앞뒤가 이어지는 흐름(비공개)] ${flow}
[헷갈리는 문장(비공개) — 관련 있어 보이지만 실은 주제에 기여해서 빼면 안 되는 문장]
${trapsText}
[바로 쓸 수 있는 검증 질문(check_questions) — 상황에 맞게 변형해서 사용]
${checksText}
${rubric.note ? `[유의] ${rubric.note}` : ""}
${input ? `\n지금 이 학생이 쓴 것: "${input}" — 이걸 이어받아 시작하세요(처음부터 다시 묻지 말 것).` : ""}

# 행동 지침 (무관 문제)
무관은 "문장을 고르고 끝내기"를 허용하지 않습니다. 반드시 "후보 문장을 실제로 빼보고 → 앞뒤 연결 확인 → 주제 관련성 확인"을 유도하세요.
1. 절대 정답 문장 번호를 확정해 주지 마세요. "정답은 ③이에요" 같은 확언은 물론, 문장 번호 자체를 답으로 노출 금지.
2. 학생이 문장을 고르면 바로 맞다/틀리다 하지 말고 되물으세요: "그 문장을 빼고 앞뒤를 이어서 읽어보세요. 자연스럽게 이어지나요?"
3. 주제 관련성을 묻습니다: "그 문장이 글 전체가 말하려는 것과 관련이 있나요, 아니면 딴 얘기인가요?"
4. 학생이 헷갈리는 문장(trap_sentences)을 골랐으면: "그 문장을 빼면 오히려 글이 어색해지지 않나요? 그 문장이 주제를 뒷받침하진 않나요? 다시 읽어볼까요?" (trap_sentences를 되묻기 재료로만 활용)
5. 한 번에 하나만 물으세요(전체 규칙 5와 동일). 되묻기 → 학생 답 대기 → 다음 되묻기.`;
};

// 챗 LLM은 서강대 게이트웨이(OpenAI 호환) 경유. 한 형식으로 여러 모델을 받으므로
// 클라이언트가 보낸 model을 화이트리스트로 검증만 하고 그대로 전달한다.
const GATEWAY_URL = "https://factchat-cloud.mindlogic.ai/v1/gateway/chat/completions/";
const ALLOWED_MODELS = ["gpt-5.1", "claude-sonnet-5"];
const DEFAULT_MODEL = "gpt-5.1";

// ── LLM 프로바이더 선택 ──────────────────────────────────────────────────────
// 게이트웨이 쿼터 소진(402) 대응: 기본은 사용자 직속 OpenAI 계정(gpt-4o-mini, 저렴한 챗).
// 게이트웨이 크레딧이 리셋되면 LLM_PROVIDER=gateway 로 세팅하면 코드 변경 0으로 원복된다.
const LLM_PROVIDER = Deno.env.get("LLM_PROVIDER") ?? "openai";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_CHAT_MODEL = "gpt-4o-mini"; // 저렴한 챗 (직속 OpenAI)

// callChat: OpenAI 호환 chat/completions 요청을 선택된 프로바이더로 보낸다.
// gateway 경로는 요청받은(ALLOWED_MODELS 로 검증된) 모델을 그대로 쓰고, openai 경로는
// gpt-4o-mini 로 강제한다(gpt-5.1/claude-sonnet-5 는 api.openai.com 에 존재하지 않음).
// 응답 형식이 동일하므로 파싱은 provider-agnostic (choices[0].message.content).
// 실제 사용한 모델명을 함께 반환해 로그·응답의 model 필드가 정확하도록 한다.
async function callChat(
  messages: { role: string; content: string }[],
  opts: { maxTokens: number; gatewayModel: string },
): Promise<{ content: string; model: string }> {
  // LLM_PROVIDER=gateway 로 두면 아래 openai 블록을 건너뛰고 게이트웨이로 원복(코드 변경 0).
  const useOpenai = LLM_PROVIDER !== "gateway";
  const url = useOpenai ? OPENAI_URL : GATEWAY_URL;
  const key = useOpenai
    ? Deno.env.get("OPENAI_API_KEY")
    : Deno.env.get("GATEWAY_API_KEY");
  const model = useOpenai ? OPENAI_CHAT_MODEL : opts.gatewayModel;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, max_tokens: opts.maxTokens, messages }),
  });
  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? "";
  return { content, model };
}

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    // supabase-js functions.invoke가 apikey·x-client-info 헤더를 보내므로 반드시 허용해야
    // 브라우저 프리플라이트(OPTIONS)가 통과한다. (curl은 CORS가 없어 이 누락이 안 보임)
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // 1. JWT 검증 — anon 클라이언트로 사용자 확인
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response("Unauthorized", { status: 401, headers: cors });

    const {
      problem_id, messages, use_rag = true, model: reqModel, input_mode,
      wizard_context, chat_entry_point, entry_trigger, wizard_state_snapshot,
    } = await req.json();
    const model = ALLOWED_MODELS.includes(reqModel) ? reqModel : DEFAULT_MODEL;
    // 학생 입력이 어느 층에서 왔는지 기록 (연구용). 유효값 외에는 null.
    const inputMode = ["button", "text", "quick_reply"].includes(input_mode) ? input_mode : null;
    // 위저드 이어받기 진입 로깅 (nullable — 없으면 null). 응답 형태는 바꾸지 않는다.
    const chatEntryPoint = typeof chat_entry_point === "string" ? chat_entry_point : null;
    const entryTrigger = typeof entry_trigger === "string" ? entry_trigger : null;
    const wizardStateSnapshot = wizard_state_snapshot ?? null;
    const wizardContext =
      wizard_context && typeof wizard_context === "object" ? wizard_context : null;
    const lastUser = messages.filter((m: any) => m.role === "user").at(-1)?.content ?? "";

    // 2. 리트리벌 (service_role — teacher_chunks는 클라이언트 정책 0개)
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 문제 데이터 로드 — 지문/선지/정답을 시스템 프롬프트에 주입한다.
    // 지문이 없으면 대리 풀이 위험이 있으므로 튜터링을 막는다(진입 차단).
    const { data: problem } = await admin.from("problems")
      .select("question_type, passage, choices, answer, grading_rubric").eq("id", problem_id).maybeSingle();
    if (!problem_id || !problem || !String(problem.passage ?? "").trim()) {
      return new Response(
        JSON.stringify({ error: "문제 지문이 없습니다. 문제를 먼저 선택하세요." }),
        { status: 400, headers: cors },
      );
    }

    let retrievedIds: string[] = [];
    let system = buildSystem(problem);

    if (use_rag && lastUser) {
      // 질의 임베딩 — Supabase 내장 gte-small(384차원). 외부 키·엔드포인트 불필요.
      // 코퍼스(teacher_chunks)도 동일 모델로 임베딩해야 리트리벌이 유효함.
      // @ts-ignore Supabase는 Edge Runtime 전역 (로컬 타입 없음)
      const session = new Supabase.ai.Session("gte-small");
      const emb = await session.run(lastUser, { mean_pool: true, normalize: true });

      const runMatch = (filter_type: string | null) =>
        admin.rpc("match_teacher_chunks", {
          query_embedding: emb,
          match_count: 3,
          filter_type,
        });

      // 소프트 폴백: 유형 필터로 먼저 검색 → 0개면 필터 없이 재검색.
      // 코퍼스가 유형 태깅되면 유형 조건화가 살아나고, 미태깅 상태에선 RAG가 죽지 않음.
      let { data: chunks } = await runMatch(problem.question_type || null);
      if (!chunks?.length) {
        ({ data: chunks } = await runMatch(null));
      }

      if (chunks?.length) {
        retrievedIds = chunks.map((c: any) => c.id);
        const blob = chunks
          .map((c: any) => `--- 발췌 ${c.id} ---\n${c.content.slice(0, 800)}`)
          .join("\n\n");
        system += RAG_SLOT(blob);
      }
    }

    // 위저드 이어받기: 막힌 지점을 시스템 프롬프트에 주입해 처음부터 다시 묻지 않게 한다.
    if (wizardContext) {
      system += WIZARD_SLOT(wizardContext);
    }

    // 순서 문제 전용 비공개 채점 근거: 학생이 순서 위저드 단계에서 넘어왔고,
    // 해당 문제의 rubric이 order 타입일 때만 주입한다. (정답 순서·근거는 응답에 절대 넣지 않음)
    const ORDER_STEPS = ["eliminate", "arrange", "order_choice"];
    const rubric = (problem as any).grading_rubric;
    if (
      wizardContext &&
      ORDER_STEPS.includes(String(wizardContext.step)) &&
      rubric &&
      typeof rubric === "object" &&
      rubric.type === "order"
    ) {
      system += ORDER_GUIDANCE_SLOT(rubric, wizardContext);
    }

    // 어법 문제 전용 비공개 채점 근거: 학생이 어법 위저드 단계에서 넘어왔고,
    // 해당 문제의 rubric이 grammar 타입일 때만 주입한다. (정답 번호·범주·근거는 응답에 절대 넣지 않음)
    const GRAMMAR_STEPS = ["grammar_diagnose", "grammar_subject", "grammar_choice"];
    if (
      wizardContext &&
      GRAMMAR_STEPS.includes(String(wizardContext.step)) &&
      rubric &&
      typeof rubric === "object" &&
      rubric.type === "grammar"
    ) {
      system += GRAMMAR_GUIDANCE_SLOT(rubric, wizardContext);
    }

    // 어휘 문제 전용 비공개 채점 근거: 학생이 어휘 위저드 단계에서 넘어왔고,
    // 해당 문제의 rubric이 vocab 타입일 때만 주입한다. (정답 번호·글 부호·근거는 응답에 절대 넣지 않음)
    const VOCAB_STEPS = ["vocab_topic", "vocab_polarity", "vocab_diagnose", "vocab_choice"];
    if (
      wizardContext &&
      VOCAB_STEPS.includes(String(wizardContext.step)) &&
      rubric &&
      typeof rubric === "object" &&
      rubric.type === "vocab"
    ) {
      system += VOCAB_GUIDANCE_SLOT(rubric, wizardContext);
    }

    // 삽입 문제 전용 비공개 채점 근거: 학생이 삽입 위저드 단계에서 넘어왔고,
    // 해당 문제의 rubric이 insert 타입일 때만 주입한다. (정답 위치·연결 단서·트랩은 응답에 절대 넣지 않음)
    const INSERT_STEPS = ["insert_pick", "insert_verify", "insert_cue", "insert_confirm"];
    if (
      wizardContext &&
      INSERT_STEPS.includes(String(wizardContext.step)) &&
      rubric &&
      typeof rubric === "object" &&
      rubric.type === "insert"
    ) {
      system += INSERT_GUIDANCE_SLOT(rubric, wizardContext);
    }

    // 무관 문제 전용 비공개 채점 근거: 학생이 무관 위저드 단계에서 넘어왔고,
    // 해당 문제의 rubric이 omit 타입일 때만 주입한다. (정답 문장 번호·무관 이유·흐름·함정은 응답에 절대 넣지 않음)
    const OMIT_STEPS = ["omit_topic", "omit_intro", "omit_scan", "omit_confirm", "omit_explain", "omit_recover"];
    if (
      wizardContext &&
      OMIT_STEPS.includes(String(wizardContext.step)) &&
      rubric &&
      typeof rubric === "object" &&
      rubric.type === "omit"
    ) {
      system += OMIT_GUIDANCE_SLOT(rubric, wizardContext);
    }

    // 3. LLM 호출 — 프로바이더 라우팅은 callChat 이 담당(LLM_PROVIDER 로 openai↔gateway 전환).
    //    openai 경로는 gpt-4o-mini 강제, gateway 경로는 검증된 model 그대로.
    //    system은 messages 맨 앞에 넣는 OpenAI 형식.
    const { content: answer, model: usedModel } = await callChat(
      [{ role: "system", content: system }, ...messages],
      { maxTokens: 1024, gatewayModel: model },
    );
    const tagMatch = answer.match(/\[전략:\s*([^\]]+)\]/);
    // 콤마로만 분리하고 각 태그는 trim — "Feature Relevance" 같은 복수 단어 전략 보존
    const strategyTags = tagMatch
      ? tagMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    // 4. 로그 저장 (user_id는 검증된 JWT 기준)
    // 프로비넌스: 실제 프로바이더와 corpus_role 을 기록한다.
    //   corpus_role='research' 는 오직 '진짜' gateway+claude-sonnet-5 실호출에만 부여(연구 코퍼스).
    //   그 외(openai, 또는 gateway+gpt-5.1)는 전부 'pilot'.
    const chatProvider = LLM_PROVIDER === "gateway" ? "gateway" : "openai";
    const corpusRole =
      LLM_PROVIDER === "gateway" && usedModel === "claude-sonnet-5" ? "research" : "pilot";
    await admin.from("chat_messages").insert([
      { user_id: user.id, problem_id, role: "user", content: lastUser,
        condition: use_rag ? "rag" : "no_rag", input_mode: inputMode,
        chat_entry_point: chatEntryPoint, entry_trigger: entryTrigger,
        wizard_state_snapshot: wizardStateSnapshot,
        provider: chatProvider, corpus_role: corpusRole },
      { user_id: user.id, problem_id, role: "assistant", content: answer,
        condition: use_rag ? "rag" : "no_rag", model: usedModel,
        retrieved_ids: retrievedIds, strategy_tags: strategyTags,
        provider: chatProvider, corpus_role: corpusRole },
    ]);

    // 5. 응답 — 교사 전사 원문은 포함하지 않는다
    return new Response(
      JSON.stringify({ answer, model: usedModel, provider: chatProvider, corpus_role: corpusRole, retrieved_ids: retrievedIds, strategy_tags: strategyTags }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: cors });
  }
});
