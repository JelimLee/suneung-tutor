// supabase/functions/generate-rubric/index.ts
// 역할: 문제 하나(지문/선지/정답)를 받아 빈칸 형성평가 채점키(grading_rubric)를 생성한다.
//   - 재사용 독립 모듈: 30문제 배치 생성 + 나중의 학생 문제 업로드 모두 이 엔드포인트를 쓴다.
//   - 모델은 claude-sonnet-5 고정 (채점 일관성). 챗은 두 모델 토글이지만 rubric은 단일.
//   - LLM 호출은 서강대 게이트웨이(OpenAI 호환) 경유, 키는 Edge secret(GATEWAY_API_KEY).
//   - store=true + problem_id 이면 service_role로 problems.grading_rubric 에 저장(기본은 저장 안 함).
// 배포: supabase functions deploy generate-rubric

import { createClient } from "npm:@supabase/supabase-js@2";

const GATEWAY_URL = "https://factchat-cloud.mindlogic.ai/v1/gateway/chat/completions/";
const RUBRIC_MODEL = "claude-sonnet-5"; // 고정 (게이트웨이 경로 전용 모델명)

// ── LLM 프로바이더 선택 ──────────────────────────────────────────────────────
// 게이트웨이 쿼터 소진(402) 대응: 기본은 사용자 직속 OpenAI 계정(gpt-4o)으로 라우팅.
// 게이트웨이 크레딧이 리셋되면 LLM_PROVIDER=gateway 로 세팅하면 코드 변경 0으로 원복된다.
const LLM_PROVIDER = Deno.env.get("LLM_PROVIDER") ?? "openai";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o"; // rubric 품질 (직속 OpenAI)

// ── 실제 모델·프로바이더 프로비넌스 ─────────────────────────────────────────
// rubric 객체에 기록되는 model/provider 는 '고정 RUBRIC_MODEL'이 아니라 실제로
// 호출된 프로바이더/모델이어야 한다(callChat 의 라우팅과 동일 규칙).
//   openai 경로  → gpt-4o / openai
//   gateway 경로 → claude-sonnet-5 / gateway
const ACTUAL_PROVIDER = LLM_PROVIDER === "gateway" ? "gateway" : "openai";
const ACTUAL_MODEL = LLM_PROVIDER === "gateway" ? RUBRIC_MODEL : OPENAI_MODEL;

// callChat: OpenAI 호환 chat/completions 요청을 선택된 프로바이더로 보낸다.
// 두 프로바이더가 동일한 요청/응답 형식이라 호출부는 data.choices[0].message.content 를
// 그대로 파싱한다. {status, data, content} 를 반환해, 각 제너레이터의 재시도 루프가
// 기존과 동일하게 (gw status ...) 에러 텍스트로 non-2xx status + body 를 표면화하게 한다.
async function callChat(
  messages: { role: string; content: string }[],
  opts: { maxTokens: number },
): Promise<{ status: number; data: any; content: string }> {
  // LLM_PROVIDER=gateway 로 두면 아래 openai 블록을 건너뛰고 게이트웨이로 원복(코드 변경 0).
  const useOpenai = LLM_PROVIDER !== "gateway";
  const url = useOpenai ? OPENAI_URL : GATEWAY_URL;
  const key = useOpenai
    ? Deno.env.get("OPENAI_API_KEY")
    : Deno.env.get("GATEWAY_API_KEY");
  const model = useOpenai ? OPENAI_MODEL : RUBRIC_MODEL;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, max_tokens: opts.maxTokens, messages }),
  });
  const status = res.status;
  const data = await res.json().catch(() => ({}));
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  return { status, data, content };
}

// 문장 분할 — 클라이언트 lib/solve/passage.ts 의 segmentSentences 와 동일 알고리즘이어야
// polarity 인덱스가 정렬된다. (둘을 반드시 동기화할 것)
function segmentSentences(passage: string): string[] {
  const normalized = passage.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const primary = normalized
    .split(/(?<=[.!?])\s+(?=[A-Z"'“‘])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (primary.length >= 2) return primary;
  const fallback = normalized
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return fallback.length ? fallback : [normalized];
}

// ── rubric 생성 프롬프트 v2 (rubric_gen_prompt_v2.txt 미첨부 → 사용자 스펙으로 구성) ──
// 요구사항: 4개 topic 카테고리에 예시 강제(빈 배열 금지), canonical/note 포함,
//           채점 철학(방향 O / 좁힘 X / 상위어 X / 틀림 X, 정확한 이해 요구).
const buildPrompt = (
  passage: string,
  sentences: string[],
  choices: string[],
  answer: number | null,
) => {
  const sentList = sentences.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const choiceList = (choices ?? []).map((c, i) => `${i + 1}. ${c}`).join("\n");
  const answerLine =
    answer != null ? `${answer}번` : "미상 — 지문 근거로 정답을 추론하라";
  return `당신은 수능 영어 '빈칸 추론' 문제의 형성평가 채점키(rubric)를 만드는 전문가입니다.
학생의 사전 사고(소재/서론유형/문장극성/주제)를 채점할 기준을 JSON으로 생성하세요.
학생은 소재·주제를 한국어 단어/문장으로 입력합니다.

[지문]
${passage}

[문장 목록] — polarity 채점용. 이 번호/순서를 그대로 사용하세요. (총 ${sentences.length}문장)
${sentList}

[선지]
${choiceList}
[정답] ${answerLine}

# 채점 철학 (topic)
- 방향이 맞으면 O(accept). 세부로 지나치게 좁히면 X(too_narrow). 상위어·지나치게 포괄이면 X(too_broad). 방향이 틀리면 X(wrong).
- 정확한 이해를 요구하되, 방향만 맞으면 관대하게 accept. 상위어는 거부.

# 생성 규칙
1) topic — "이 글의 소재를 한 단어로?"를 채점하는 키. 반드시 아래 6필드 모두 채우세요.
   - canonical: 가장 대표적인 정답 소재 단어 1개(한국어).
   - accept: 방향이 맞는 소재 단어들(canonical 동의어·표현 변형 포함). **최소 4개**.
   - reject_too_narrow: 소재를 세부로 지나치게 좁힌 단어들. **최소 3개**.
     · 특히 소재를 '거래/상거래/판매/물건 사고팔기' 같은 상업 행위로 좁힌 것도 reject_too_narrow에 포함하세요. 경제·화폐 지문에서 특히 흔한 디테일 오류입니다.
   - reject_too_broad: 상위어·지나치게 포괄적 단어들(예: 사회, 인간, 삶). **최소 3개**.
   - reject_wrong: 방향이 틀린 단어들. **최소 3개**.
   - note: 이 소재를 어떻게 채점해야 하는지 한 줄 메모.
   ※ 어떤 배열도 비워두지 마세요. 예시가 부족하면 그럴듯한 변형을 만들어서라도 채우세요.
2) intro_type — 서론 유형 정답 하나: "통념" | "주장" | "배경지식".
   통념=흔한 생각을 제시 후 뒤집는 도입 / 주장=글쓴이 입장을 처음부터 / 배경지식=사실·정보 도입.
3) polarity — [문장 목록] 각 문장이 글의 주제(빈칸이 요구하는 방향)와
   같은편이면 "+", 반대면 "-", 중립·모호면 "?". 문장 순서대로 배열. 길이는 정확히 ${sentences.length}.
4) theme_keywords — 주제문에 반드시 들어갈 핵심 키워드(한국어) 3~6개.
5) answer — 정답 선지 번호(1-based). [정답]이 주어졌으면 그대로, 미상이면 지문 근거로 추론.
6) recovery — 【복구 진단 전용·화면 노출 금지】 빈칸 앞뒤 문맥이 세우는 '논리 관계'와 각 선지의 만족 여부.
   - axis: 항상 "relation".
   - relation: 빈칸을 둘러싼 문맥이 요구하는 논리 관계 하나 — "재진술" | "대조" | "인과" | "예시".
   - choice_satisfies: 각 선지 번호(1..${(choices ?? []).length})를 key(문자열)로, 그 선지가 위 relation 을
     만족하면 true, 어기면 false. 정답 선지는 반드시 true. 나머지 오답은 그 관계를 왜 어기는지
     판단해 false 로 표시하라(⚠️ 각 오답이 관계를 어떻게 위반하는지 신중히 — 오류가 잦은 축).

# 출력
아래 JSON 객체만 출력하세요. 설명·코드펜스 금지.
{"topic":{"canonical":"","accept":[],"reject_too_narrow":[],"reject_too_broad":[],"reject_wrong":[],"note":""},"intro_type":"","polarity":[],"theme_keywords":[],"answer":0,"recovery":{"axis":"relation","relation":"재진술","choice_satisfies":{"1":true}}}`;
};

function extractJson(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("JSON을 찾지 못함");
  return JSON.parse(text.slice(start, end + 1));
}

// ── 순서(sentence-ordering) rubric ──────────────────────────────────────────
// parseOrderPassage: 클라이언트 src/lib/solve/order.ts 의 것과 동일 알고리즘이어야
// 한다. (둘을 반드시 동기화할 것 — keep in sync with src/lib/solve/order.ts)
type OrderLabel = "A" | "B" | "C";
const GIVEN_RE = /\[주어진\s*글\]\s*/;
const BLOCK_RE = /\(\s*([ABC])\s*\)/g;

function parseOrderPassage(
  passage: string,
): { given: string; blocks: { label: OrderLabel; text: string }[] } {
  const text = (passage ?? "").replace(/\r/g, "");
  const firstSeen = new Set<string>();
  const markers: { label: OrderLabel; markerStart: number; contentStart: number }[] = [];
  for (const m of text.matchAll(BLOCK_RE)) {
    const label = m[1] as OrderLabel;
    if (firstSeen.has(label)) continue;
    firstSeen.add(label);
    markers.push({
      label,
      markerStart: m.index ?? 0,
      contentStart: (m.index ?? 0) + m[0].length,
    });
  }
  markers.sort((a, b) => a.markerStart - b.markerStart);
  if (markers.length === 0) return { given: text.trim(), blocks: [] };

  const firstBlockStart = markers[0].markerStart;
  const givenMatch = GIVEN_RE.exec(text);
  const givenStart = givenMatch ? givenMatch.index + givenMatch[0].length : 0;
  const given = text.slice(givenStart, firstBlockStart).trim();
  const blocks = markers.map((mk, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].markerStart : text.length;
    return { label: mk.label, text: text.slice(mk.contentStart, end).trim() };
  });
  blocks.sort((a, b) => a.label.localeCompare(b.label));
  return { given, blocks };
}

// "(C)-(B)-(A)" | "C-B-A" → "C-B-A"
function normalizeOrderString(s: string): string {
  return (s ?? "")
    .replace(/[()\s]/g, "")
    .split("-")
    .map((p) => p.toUpperCase())
    .filter((p) => p === "A" || p === "B" || p === "C")
    .join("-");
}

// Adjacent pairs of the correct order, as [first, second] (first comes earlier).
function adjacentPairs(order: string): [OrderLabel, OrderLabel][] {
  const seq = (order ?? "")
    .split("-")
    .filter((p) => p === "A" || p === "B" || p === "C") as OrderLabel[];
  const pairs: [OrderLabel, OrderLabel][] = [];
  for (let i = 0; i + 1 < seq.length; i++) pairs.push([seq[i], seq[i + 1]]);
  return pairs;
}
// Label-sorted key/labels for a pair so it never encodes the answer direction.
function pairKeyLabels(a: OrderLabel, b: OrderLabel): { key: string; labels: OrderLabel[] } {
  const labels = [a, b].sort() as OrderLabel[];
  return { key: labels.join("-"), labels };
}

const buildOrderPrompt = (
  given: string,
  blocks: { label: OrderLabel; text: string }[],
  choices: string[],
  answer: number | null,
  correctOrder: string,
) => {
  const blockList = blocks
    .map((b) => `(${b.label}) ${b.text}`)
    .join("\n\n");
  const choiceList = (choices ?? []).map((c, i) => `${i + 1}. ${c}`).join("\n");
  const answerLine = answer != null ? `${answer}번` : "미상";
  const orderPairs = adjacentPairs(correctOrder);
  const pairSpec = orderPairs
    .map(([first, second]) => {
      const { key } = pairKeyLabels(first, second);
      return `- pair "${key}": 실제로는 (${first})가 (${second})보다 먼저 옵니다.`;
    })
    .join("\n");
  return `당신은 수능 영어 '글의 순서' 문제의 형성평가 채점키(rubric)를 만드는 전문가입니다.
학생이 "연결사·지시대명사·예시 대응" 세 단서로 순서를 스스로 판단하도록 유도하는 채점키를 JSON으로 생성하세요.

# 채점 철학 (교사의 실제 풀이법)
순서는 세 가지 단서로 판단한다:
1. 연결사: However, This, For instance, But, Thus 등이 어느 단락 앞에 오면 자연스러운지.
2. 지시대명사 추적: He/she/it/they/this/the+명사 가 나오면, 그것이 가리키는 대상이 앞에 먼저 나와야 함.
   예: (B)의 "this stress"가 (C)의 "CrossFit"을 가리키면 → C가 B보다 먼저(C→B).
3. 예시 대응 (배경지식형 주어진 글): 주어진 글이 배경지식이면(예: "무게가 지구와 우주에서 다르다"),
   A/B/C 각각이 어느 개념(지구/우주)의 예시인지 나누고, 어느 쪽이 먼저 와야 자연스러운지 판단.
   보통 두 개까지 좁힌 뒤 마지막 판별.

[주어진 글]
${given}

[블록] — 이 라벨을 그대로 사용하세요.
${blockList}

[선지]
${choiceList}
[정답] ${answerLine}
[정답 순서] ${correctOrder}   ← 이 순서가 확정된 정답입니다. 이 순서를 근거로 채점키를 만드세요.

# 생성 규칙
1) blocks — 존재하는 모든 블록(위 [블록]의 라벨)에 대해 각각:
   - label: "A" | "B" | "C"
   - opening_cue: 그 블록이 시작하는 핵심 연결사·지시어(원문 그대로, 예: "However", "This", "If"). 없으면 첫 어구.
   - refers_to: 그 블록이 이어받는 대상 — "주어진 글" | "A" | "B" | "C" 중 하나.
   - role: 그 블록의 담화 역할 한 줄(예: "상황 도입", "실패 사례", "성공 사례로 전환").
2) anchor — 주어진 글 바로 다음에 오는 블록과 그 근거:
   - block: 정답 순서의 첫 블록(= ${correctOrder.split("-")[0] ?? ""}).
   - why: 왜 이 블록이 먼저 오는지 한 줄.
3) referent_chains — 【가장 중요】 지시대명사 추적 단서(문자열 배열, 최소 1개).
   각 블록의 지시대명사(it/they/this/these/the+명사 등)가 앞의 어느 명사·대상을 가리키는지,
   그래서 어떤 순서가 강제되는지 한 문장으로. 예: "B의 this stress는 C의 CrossFit을 가리키므로 C→B".
   지시대명사가 하나라도 있으면 절대 비워두지 마세요. 연결사가 없는 블록도 지시어·논리로 근거를 만드세요.
4) example_mapping — 주어진 글이 '배경지식형'(사실·개념 도입)이면, 각 단락이 어느 개념의 예시인지 문자열로 서술.
   배경지식형이 아니면 null.
5) traps — 학생이 흔히 고르는 오답 순서 2~3개. 각각:
   - order: "A-C-B" 형식(정답과 달라야 함).
   - why: 왜 그 순서가 틀렸는지 한 줄.
6) connective_keywords — 순서 판단의 단서가 되는 연결사·지시어 키워드 3~6개(영어/한국어).
7) check_questions — 학생에게 던질 판단 질문 2~3개(문자열 배열).
   예: "C의 it은 앞의 무엇을 가리키나요?", "주어진 글 다음엔 A/B/C 중 뭐가 자연스럽나요?".
8) note — 이 문제 채점 시 유의점 한 줄.
9) why_options + pair_options — 【0-토큰 이유 확인용】 학생이 결정 지점에서 "왜 그렇게 생각했어요?"에
   버튼으로 답하도록, 각 지점마다 이유 후보(chip)들을 미리 생성합니다.
   런타임 채점은 correct 플래그의 단순 조회이므로(추가 토큰 0), 여기서 정답 논리를 확실히 심어야 합니다.

   (가) why_options.eliminate — "왜 이 블록은 주어진 글 바로 다음에 올 수 없나?"의 이유 후보 세트.
   ※ pair_options와 똑같은 기준을 적용하세요: 정답은 결론이 아니라 '단서'만, 오답 중 하나는 '그럴듯하지만 틀린' 것.
   · 정확히 3개 chip, 그 중 1개만 correct:true.
   · id: 'e1','e2','e3'.
   · label: 학생에게 보이는 짧은 한국어 한 줄(약 30자 이내). rubric 용어·정답순서 나열 금지.
     (1) correct:true 1개 = 지시어 단서만 한 줄. 결론(어느 게 첫 단락인지·전체 순서)을 흘리지 말 것.
         예: '맨 앞에 앞엣것을 가리키는 말이 있는데 그 대상이 주어진 글에 없어서'.
         (특정 블록명·용어를 다 나열해 '완벽한 설명'을 만들지 마세요 — 단서 한 줄로만.)
     (2) correct:false — '그럴듯하지만 틀린' 것. 대놓고 엉뚱하면 안 되고, 표면상 말이 되는 오개념.
         예: '내용이 구체적이라 일반적 도입보다 뒤에 와야 할 것 같아서', '연결사 없이 툭 시작해서 첫 단락 같지 않아서'.
     (3) correct:false — 감(感)·표면 기반 오답.
         예: '느낌상 첫 문단으로는 어색해서', '내용이 부정적이라'.
     → 표면 특징만으론 못 고르고, 지시어가 앞을 못 가리킨다는 걸 실제로 본 학생만 (1)을 고르게 하세요.

   (나) pair_options — "이 두 블록 중 뭐가 먼저 와요?"를 인접 쌍마다 확인하는 세트.
   아래 쌍 목록의 각 pair(라벨 오름차순 정렬 key)마다 정확히 3개의 option chip을 만드세요.
   ※ 각 pair의 '실제로 먼저 오는 블록'은 아래에 명시돼 있습니다:
${pairSpec}
   · 각 pair 규칙 — 정확히 3개 chip:
     (1) correct:true 1개 = 실제로 먼저 오는 블록을 지목 + 진짜 근거(지시대명사·연결사·지시어 단서 한 줄).
         예: 'C 먼저 — B의 this stress가 C의 CrossFit을 가리켜서'.
     (2) correct:false — 방향이 틀린 것(나중 블록을 먼저라고) + 표면적 이유.
         예: 'B 먼저 — B가 더 짧아서'.
     (3) correct:false — 방향은 맞지만 근거가 약한 것(감·순서상).
         예: 'C 먼저 — 그냥 순서상'.
     → 방향만으로는 못 고르고, 지시어를 실제로 추적한 학생만 (1)을 고르게 하세요.
   · label 형식: '블록 먼저 — 이유' (약 30자 이내 한국어). 절대 전체 순서(예: C-B-A)를 label에 넣지 마세요.
   · pair_options는 위 쌍 목록의 라벨-정렬 key(예: "B-C","A-B")로 키를 맞추세요.
   · id: 각 pair 안에서 'p1','p2','p3'.
10) recovery — 【복구 진단 전용·화면 노출 금지】 각 블록의 첫 지시어 신호를 자기완결로 기술.
   axis 는 항상 "signal". items 는 블록마다 하나(위 [블록]의 모든 라벨을 label 오름차순으로):
   - label: "A" | "B" | "C".
   - opening_cue: 그 블록 첫머리의 핵심 연결사·지시어(위 1)의 opening_cue 와 동일하게).
   - refers_to: 그 첫 지시어가 가리키는 대상 서술(위 1)의 refers_to 와 정합하게).
   - in_given: 그 블록의 첫 지시어가 가리키는 대상이 '주어진 글'에 이미 나와 있으면 true, 없으면 false.
     ⚠️ 주어진 글 본문을 실제로 확인해 판단하라(오류가 잦은 축이니 특히 신중하게).
   - can_be_first: 그 블록이 주어진 글 바로 다음 첫 블록이 될 수 있으면 true.

# 출력
아래 JSON 객체만 출력하세요. 설명·코드펜스 금지.
※ string 값 안에서 영어 어구를 인용할 때는 큰따옴표(")를 쓰지 말고 작은따옴표(')만 사용하세요.
   JSON 문법을 깨는, 이스케이프되지 않은 큰따옴표를 문자열 값 안에 절대 넣지 마세요.
{"blocks":[{"label":"","opening_cue":"","refers_to":"","role":""}],"anchor":{"block":"","why":""},"referent_chains":[],"example_mapping":null,"traps":[{"order":"","why":""}],"connective_keywords":[],"check_questions":[],"note":"","why_options":{"eliminate":[{"id":"e1","label":"","correct":true},{"id":"e2","label":"","correct":false},{"id":"e3","label":"","correct":false}]},"pair_options":[{"pair":"B-C","options":[{"id":"p1","label":"","correct":true},{"id":"p2","label":"","correct":false},{"id":"p3","label":"","correct":false}]}],"recovery":{"axis":"signal","items":[{"label":"A","opening_cue":"","refers_to":"","in_given":false,"can_be_first":false}]}}`;
};

// 독립 재사용 함수: 지문/선지/정답 → 순서 채점키 rubric 객체 (claude-sonnet-5 고정)
export async function generateOrderRubric(
  passage: string,
  choices: string[],
  answer: number | null,
  opts: { gatewayKey: string },
) {
  const { given, blocks } = parseOrderPassage(passage);
  // 정답 순서는 LLM이 아니라 정답 선지에서 확정한다(ground truth).
  const correctOrder =
    answer != null && Array.isArray(choices) && choices[answer - 1]
      ? normalizeOrderString(choices[answer - 1])
      : "";

  // 게이트웨이가 이스케이프 안 된 큰따옴표로 깨진 JSON을 뱉으면 1회 재시도.
  const orderPrompt = buildOrderPrompt(given, blocks, choices, answer, correctOrder);
  let parsed: any;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    // 프로바이더 라우팅은 callChat 이 담당(LLM_PROVIDER 로 openai↔gateway 전환).
    // why_options 추가로 순서 rubric JSON이 길어져 2000이면 잘려서(truncated) 파싱 실패→500.
    // 넉넉히 상향. (blank 브랜치는 짧아 2000 유지)
    const { status, data, content } = await callChat(
      [
        { role: "system", content: "너는 정확한 JSON만 출력하는 채점키 생성기다." },
        { role: "user", content: orderPrompt },
      ],
      { maxTokens: 4500 },
    );
    try {
      parsed = extractJson(content);
      break;
    } catch (e) {
      // Surface what the gateway actually returned (rate-limit/quota/error bodies
      // arrive as non-JSON content and were previously swallowed as "JSON 못 찾음").
      lastErr = new Error(
        `order rubric parse fail (gw status ${status}): ${JSON.stringify(data).slice(0, 500)}`,
      );
    }
  }
  if (parsed === undefined) throw lastErr;

  // ── NORMALIZE ──
  // correct_order 는 무조건 정답 선지에서 파생한 값으로 강제.
  const forcedOrder = correctOrder;
  const firstLabel = forcedOrder.split("-")[0] ?? "";

  // blocks: 지문에 존재하는 모든 라벨을 커버(빠진 라벨은 빈 값으로 채움).
  const parsedBlocks: any[] = Array.isArray(parsed.blocks) ? parsed.blocks : [];
  const byLabel = new Map<string, any>();
  for (const b of parsedBlocks) {
    if (b && (b.label === "A" || b.label === "B" || b.label === "C")) {
      byLabel.set(b.label, b);
    }
  }
  const normBlocks = blocks.map((b) => {
    const src = byLabel.get(b.label) ?? {};
    return {
      label: b.label,
      opening_cue: typeof src.opening_cue === "string" ? src.opening_cue : "",
      refers_to: typeof src.refers_to === "string" ? src.refers_to : "",
      role: typeof src.role === "string" ? src.role : "",
    };
  });

  // anchor.block 은 정답 순서 첫 라벨로 강제, why 는 LLM 값 유지.
  const anchor = {
    block: firstLabel,
    why:
      parsed.anchor && typeof parsed.anchor.why === "string"
        ? parsed.anchor.why
        : "",
  };

  const traps = (Array.isArray(parsed.traps) ? parsed.traps : [])
    .filter((t: any) => t && typeof t.order === "string")
    .map((t: any) => ({
      order: normalizeOrderString(t.order),
      why: typeof t.why === "string" ? t.why : "",
    }));

  const connective_keywords = Array.isArray(parsed.connective_keywords)
    ? parsed.connective_keywords.filter((k: any) => typeof k === "string")
    : [];

  // referent_chains: 지시대명사 추적 단서(문자열 배열). 기본 [].
  const referent_chains = Array.isArray(parsed.referent_chains)
    ? parsed.referent_chains.filter((c: any) => typeof c === "string")
    : [];

  // example_mapping: 배경지식형이면 문자열, 아니면 null. 기본 null.
  const example_mapping =
    typeof parsed.example_mapping === "string" && parsed.example_mapping.trim()
      ? parsed.example_mapping
      : null;

  // check_questions: 학생에게 던질 판단 질문(문자열 배열). 기본 [].
  const check_questions = Array.isArray(parsed.check_questions)
    ? parsed.check_questions.filter((q: any) => typeof q === "string")
    : [];

  // why_options: 버튼식 이유 확인용. 각 세트는 정확히 1개만 correct:true 로 강제한다.
  // 런타임 채점이 correct 플래그의 단순 조회이므로 여기서 불변식을 반드시 지킨다.
  const normalizeWhySet = (raw: any, prefix: "e" | "a") => {
    const arr: any[] = Array.isArray(raw) ? raw : [];
    // label 이 있는 항목만 채택.
    const items = arr
      .filter((o) => o && typeof o.label === "string" && o.label.trim())
      .map((o) => ({
        label: o.label.trim(),
        correct: o.correct === true,
      }));
    if (items.length === 0) return [] as { id: string; label: string; correct: boolean }[];
    // 정확히 하나만 correct:true 로 강제.
    // - true 가 여러 개면 첫 true 만 유지, 나머지는 false.
    // - true 가 하나도 없으면 첫 항목을 true 로 승격(복구 불가 시에도 well-formed 유지).
    let trueSeen = false;
    for (const it of items) {
      if (it.correct && !trueSeen) {
        trueSeen = true;
      } else {
        it.correct = false;
      }
    }
    if (!trueSeen) items[0].correct = true;
    // id 를 안정적으로 재부여(prefix+1-based).
    return items.map((it, i) => ({
      id: `${prefix}${i + 1}`,
      label: it.label,
      correct: it.correct,
    }));
  };
  const rawWhy = parsed.why_options ?? {};
  const why_options = {
    eliminate: normalizeWhySet(rawWhy.eliminate, "e"),
  };

  // pair_options: rebuild canonically from the ground-truth order; take only the
  // LLM's option chips per (label-sorted) pair. Enforce exactly 1 correct.
  const rawPairs: any[] = Array.isArray(parsed.pair_options) ? parsed.pair_options : [];
  const rawByKey = new Map<string, any>();
  for (const rp of rawPairs) {
    if (rp && typeof rp.pair === "string") {
      const norm = (rp.pair.replace(/[()\s]/g, "").toUpperCase().split("-")
        .filter((p: string) => p === "A" || p === "B" || p === "C") as OrderLabel[])
        .sort().join("-");
      if (norm) rawByKey.set(norm, rp);
    }
  }
  const normalizePairSet = (raw: any) => {
    const arr: any[] = Array.isArray(raw) ? raw : [];
    const items = arr
      .filter((o) => o && typeof o.label === "string" && o.label.trim())
      .map((o) => ({ label: o.label.trim(), correct: o.correct === true }));
    if (items.length === 0) return [] as { id: string; label: string; correct: boolean }[];
    let trueSeen = false;
    for (const it of items) {
      if (it.correct && !trueSeen) trueSeen = true;
      else it.correct = false;
    }
    if (!trueSeen) items[0].correct = true;
    return items.map((it, i) => ({ id: `p${i + 1}`, label: it.label, correct: it.correct }));
  };
  const pair_options = adjacentPairs(forcedOrder).map(([a, b]) => {
    const { key, labels } = pairKeyLabels(a, b);
    const raw = rawByKey.get(key);
    return {
      key,
      labels,
      question: `${labels[0]}와 ${labels[1]} 중 뭐가 먼저 와요?`,
      options: normalizePairSet(raw?.options),
    };
  });

  // answer: 1-based. 제공된 정답 우선, 없으면 파싱값.
  const resolvedAnswer =
    typeof answer === "number"
      ? answer
      : typeof parsed.answer === "number"
        ? parsed.answer
        : null;

  // recovery: 지시어 신호 축(HIDDEN). 블록당 하나.
  // opening_cue/refers_to 는 normBlocks 값과 정합, can_be_first = (label===anchor.block) 강제
  // (anchor 가 ground truth: 정답 순서의 첫 라벨), in_given 은 LLM 판단(오류 잦음).
  const rawRecItems: any[] = Array.isArray(parsed.recovery?.items) ? parsed.recovery.items : [];
  const recByLabel = new Map<string, any>();
  for (const it of rawRecItems) {
    if (it && (it.label === "A" || it.label === "B" || it.label === "C")) {
      recByLabel.set(it.label, it);
    }
  }
  const recovery = {
    axis: "signal" as const,
    items: normBlocks.map((b) => {
      const src = recByLabel.get(b.label) ?? {};
      return {
        label: b.label,
        opening_cue: b.opening_cue, // 블록과 동일 단서로 정합
        refers_to: b.refers_to,
        in_given: src.in_given === true, // LLM 판단
        can_be_first: b.label === anchor.block, // anchor 가 ground truth
      };
    }),
  };

  return {
    type: "order" as const,
    correct_order: forcedOrder,
    answer: resolvedAnswer,
    anchor,
    blocks: normBlocks,
    referent_chains,
    example_mapping,
    traps,
    connective_keywords,
    check_questions,
    note: typeof parsed.note === "string" ? parsed.note : "",
    why_options,
    pair_options,
    recovery,
    model: ACTUAL_MODEL,
    provider: ACTUAL_PROVIDER,
    provenance_verified: true,
  };
}

// ── 어법(grammar) rubric ────────────────────────────────────────────────────
// 형식 A(4/5문제): 지문에 (1)word … (5)word 밑줄 → choices = 밑줄 단어(정답), answer = 틀린 밑줄 번호.
// 형식 B(1문제): "조합형" — choices가 "was … it … challenge"처럼 생략부호(…)를 포함하거나
//   지문에 (\d) 밑줄 마커가 없음 → LLM 호출 없이 최소 rubric 반환(클라이언트가 폴백).
const GRAMMAR_CATEGORIES = ["준동사", "관계사", "동사", "형용사부사", "병렬", "기타"];

// 조합형(combination) 판별: 어떤 선지에 생략부호가 있거나, 지문에 (\d) 밑줄 마커가 0개.
function isCombinationGrammar(passage: string, choices: string[]): boolean {
  const hasEllipsisChoice = (choices ?? []).some(
    (c) => typeof c === "string" && (c.includes("…") || c.includes("...")),
  );
  const underlineCount = (String(passage ?? "").match(/\(\s*\d+\s*\)/g) ?? []).length;
  return hasEllipsisChoice || underlineCount === 0;
}

const buildGrammarPrompt = (
  passage: string,
  choices: string[],
  answer: number | null,
) => {
  const choiceList = (choices ?? []).map((c, i) => `(${i + 1}) ${c}`).join("\n");
  const answerLine = answer != null ? `${answer}번` : "미상 — 지문 근거로 추론";
  const answerKey = answer != null ? String(answer) : "N";
  const answerTemplateNum = answer != null ? answer : 0;
  return `당신은 수능 영어 '어법' 문제의 형성평가 채점키(rubric)를 만드는 전문가입니다.
학생이 "이 밑줄이 뭘 물어보는지 먼저 판단 → 그 범주에 맞는 체크"를 하도록 유도하는 채점키를 JSON으로 생성하세요.

# 채점 철학 (교사의 실제 풀이법)
밑줄마다 문법 범주가 다르고, 범주마다 확인할 것이 다르다:
- 준동사(-ing/-ed): 능동(ing)인지 수동(pp)인지 → 뒤에 목적어 유무로 판단.
- 관계사(which/where/that): 뒤 절이 불완전(빠진 명사)이면 which/that, 완전하면 where/when.
- 동사(is/are 등): 주어와 수일치 확인. 또는 앞 일반동사를 받는 대동사인지 확인(해석 필수).
- 형용사/부사: 보어인지 수식어인지, 문장 필수성분이 다 있는지.
- 병렬/비교/기타: 문맥에 따라.

[지문] — (1)~(${choices.length}) 밑줄 표시 포함
${passage}

[밑줄 목록] — 이 번호/순서/단어를 그대로 사용하세요. (총 ${choices.length}개)
${choiceList}
[정답(어법상 틀린 밑줄)] ${answerLine}   ← 이 번호가 확정된 정답입니다. 이 밑줄 하나만 is_correct:false 로 하세요.

# 생성 규칙
1) underlines — 위 [밑줄 목록]의 모든 밑줄에 대해 각각:
   - num: 1-based 번호(밑줄 목록 순서 그대로).
   - word: 그 밑줄의 표현(밑줄 목록의 단어 그대로).
   - category: "준동사" | "관계사" | "동사" | "형용사부사" | "병렬" | "기타" 중 하나만.
     【분류 규칙 — 반드시 준수】 명사절 접속사 that/whether/if, 관계대명사 what, 복합관계사
     whatever/whoever/whichever/wherever, 관계부사 when/where/why/how 는 모두 반드시 "관계사"로
     분류하라. 판단 기준이 전부 '뒤 절의 완전성'으로 동일하기 때문이다(뒤 절이 완전한지 → 적절 여부).
     (예: discovered (that) they could… → 관계사 / about (whether) the benefits… → 관계사 /
      (What) makes X … → 관계사 / … from (whatever) the costs exceed … → 관계사.)
     "기타"는 오직 대명사(those/their/it 등)·병렬·비교처럼 완전성·목적어 유무·수일치로
     풀리지 않는 것에만 쓴다.
   - check_point: 이 밑줄에서 학생이 '무엇을 보라'는 한 줄(예: 'lengthening 뒤에 목적어 growing seasons가 있으니 능동 분사인지 보라').
   - is_correct: 어법상 맞으면 true, 틀린 밑줄(=정답)만 false. 정확히 정답 밑줄 1개만 false.
   - why: 맞으면 왜 맞는지 / 틀리면 왜 틀렸고 무엇으로 고쳐야 하는지 한 줄.
   【범주별 진단 필드 — 해당 범주면 밑줄이 정답이든 아니든 모두 채워라】
   이 필드들은 그 밑줄의 '문법 사실'을 기술하는 것이지 '틀렸는지 여부'가 아니다.
   맞는 밑줄에도 반드시 채워라(틀림 여부는 오직 is_correct로만 표시). 최종 category에 맞는 필드만 넣고 나머지는 생략.
   - category가 "준동사"인 밑줄 → has_object: boolean.
     그 준동사 뒤에 목적어가 있으면 true(능동/-ing가 맞는 형태), 없으면 false(수동/-ed가 맞는 형태).
   - category가 "관계사"인 밑줄 → clause_complete: boolean.
     뒤에 이어지는 절이 완전하면(빠진 명사 없음) true, 불완전하면(주어·목적어 등이 빠짐) false.
   - category가 "형용사부사"인 밑줄 → correct_pos: "부사" | "형용사".
     그 자리에 문법적으로 맞는 품사(수식어면 '부사', 보어면 '형용사').
   - category가 "동사"인 밑줄 → (아래 2)의 subject 필드로 처리. 별도 진단 필드 없음.
   - category가 "병렬" 또는 "기타"인 밑줄 → 진단 필드 없음.
2) 【수일치 전용 추가 필드】 category가 "동사"이고 그 밑줄이 '주어-동사 수일치(수일치)'를 묻는 경우에만 아래 3필드를 추가하세요.
   대동사(앞 일반동사를 받는 do/be)거나 수일치가 아니면 이 3필드를 절대 넣지 마세요(생략).
   - subject_head: 주어의 핵(핵심 단어 1개). 예: 'Balancing'.
   - subject_number: "단수" | "복수".
   - accept_subject: 핵을 포함한 여러 범위 표현(문자열 배열). 좁은 핵부터 넓은 구까지 2~3개.
     반드시 subject_head 자체를 첫 원소로 포함하고, 점점 넓은 올바른 주어 구를 추가.
     예: ["Balancing", "Balancing the benefits", "Balancing the benefits to some people against the harms to others"].
3) why_options — 정답 밑줄(${answerLine})에 대해서만, 학생이 "왜 이게 틀렸어요?"에 버튼으로 답할 이유 후보 3개.
   정확히 3개 chip, 그 중 1개만 correct:true. 순서 문제의 pair_options 원칙과 동일:
   - correct:true 1개 = 진짜 문법 '단서'(결론·정답번호 나열 금지). 예: '주어가 동명사구라 단수여야 하는데 복수 동사라서'.
   - correct:false = 그럴듯하지만 틀린 오개념. 예: '주어가 멀리 있어서'.
   - correct:false = 감(感)·표면 기반. 예: '느낌상'.
   key는 정답 번호 문자열("${answerKey}"), 각 chip id는 'g1','g2','g3'. label은 약 30자 이내 한국어.
4) recovery — 【복구 진단 전용·화면 노출 금지】 각 밑줄을 범주 축으로 자기완결 기술.
   axis 는 항상 "category". items 는 밑줄마다 하나([밑줄 목록]의 모든 밑줄을 num 오름차순으로):
   - num: 1-based 번호(밑줄 목록 순서 그대로).
   - target: 그 밑줄이 '받는' 주어/수식대상을 짧은 한국어로 서술
     (예: '주어 Balancing', 'lengthening 뒤 목적어 growing seasons', '앞 일반동사 mistook 을 받는 대동사').
   - category: 위 1)의 category 와 동일한 6분류 중 하나("준동사"|"관계사"|"동사"|"형용사부사"|"병렬"|"기타").
   - is_grammatical: 어법상 맞으면 true, 틀린 밑줄(=정답)만 false.
5) note — 학생이 특히 헷갈릴 밑줄과 그 이유 한 줄.

# 출력
아래 JSON 객체만 출력하세요. 설명·코드펜스 금지.
※ string 값 안에서 영어 어구를 인용할 때는 큰따옴표(")를 쓰지 말고 작은따옴표(')만 사용하세요.
   JSON 문법을 깨는, 이스케이프되지 않은 큰따옴표를 문자열 값 안에 절대 넣지 마세요.
{"answer":${answerTemplateNum},"underlines":[{"num":1,"word":"","category":"","check_point":"","is_correct":true,"why":""}],"why_options":{"${answerKey}":[{"id":"g1","label":"","correct":true},{"id":"g2","label":"","correct":false},{"id":"g3","label":"","correct":false}]},"recovery":{"axis":"category","items":[{"num":1,"target":"","category":"","is_grammatical":true}]},"note":""}
(밑줄 객체에 범주별 필드를 추가하세요:
  준동사 → "has_object":true|false /
  관계사 → "clause_complete":true|false /
  형용사부사 → "correct_pos":"부사"|"형용사" /
  수일치 동사 → "subject_head","subject_number","accept_subject".)`;
};

// 독립 재사용 함수: 지문/선지/정답 → 어법 채점키 rubric 객체 (claude-sonnet-5 고정)
export async function generateGrammarRubric(
  passage: string,
  choices: string[],
  answer: number | null,
  opts: { gatewayKey: string },
) {
  // 조합형(combination) 서브타입: LLM 호출 없이 최소 rubric 반환(클라이언트 폴백).
  if (isCombinationGrammar(passage, choices)) {
    return {
      type: "grammar" as const,
      combination: true,
      answer: typeof answer === "number" ? answer : null,
      underlines: [] as any[],
      why_options: {} as Record<string, any[]>,
      recovery: { axis: "category" as const, items: [] as any[] },
      note: "",
      model: ACTUAL_MODEL,
      provider: ACTUAL_PROVIDER,
      provenance_verified: true,
    };
  }

  const grammarPrompt = buildGrammarPrompt(passage, choices, answer);
  // 게이트웨이가 이스케이프 안 된 큰따옴표로 깨진 JSON을 뱉으면 1회 재시도.
  let parsed: any;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    // 프로바이더 라우팅은 callChat 이 담당(LLM_PROVIDER 로 openai↔gateway 전환).
    // underlines 5개 + subject 블록 + why_options → 넉넉히 상향(순서 브랜치와 동일).
    const { status, data, content } = await callChat(
      [
        { role: "system", content: "너는 정확한 JSON만 출력하는 채점키 생성기다." },
        { role: "user", content: grammarPrompt },
      ],
      { maxTokens: 4500 },
    );
    try {
      parsed = extractJson(content);
      break;
    } catch (e) {
      // 게이트웨이가 실제로 뭘 반환했는지 표면화(레이트리밋/쿼터/에러 바디는 non-JSON).
      lastErr = new Error(
        `grammar rubric parse fail (gw status ${status}): ${JSON.stringify(data).slice(0, 500)}`,
      );
    }
  }
  if (parsed === undefined) throw lastErr;

  // ── NORMALIZE ──
  // answer 는 제공된 정답을 우선(ground truth). 없으면 파싱값.
  const forcedAnswer =
    typeof answer === "number"
      ? answer
      : typeof parsed.answer === "number"
        ? parsed.answer
        : null;

  // 파싱된 밑줄을 num으로 인덱싱.
  const parsedUnderlines: any[] = Array.isArray(parsed.underlines) ? parsed.underlines : [];
  const byNum = new Map<number, any>();
  for (const u of parsedUnderlines) {
    if (u && typeof u.num === "number") byNum.set(u.num, u);
  }

  // underlines: choices와 1:1. num=i+1, word=choices[i] 강제(ground truth).
  // is_correct: 정답 밑줄만 false, 나머지 true(정확히 1개 false 보장).
  const underlines = (choices ?? []).map((w: string, i: number) => {
    const num = i + 1;
    const src = byNum.get(num) ?? {};
    const category = GRAMMAR_CATEGORIES.includes(src.category) ? src.category : "기타";
    const isCorrect =
      forcedAnswer != null ? num !== forcedAnswer : src.is_correct !== false;
    const out: any = {
      num,
      word: w, // ground truth: LLM word 무시
      category,
      check_point: typeof src.check_point === "string" ? src.check_point : "",
      is_correct: isCorrect,
      why: typeof src.why === "string" ? src.why : "",
    };
    // subject_head 블록은 '동사 수일치' 밑줄에만. category==="동사" + subject_head 존재 시에만 부착.
    // (대동사·비수일치는 LLM이 필드를 생략하도록 프롬프트에서 지시 → 여기서도 부착 안 됨)
    if (category === "동사" && typeof src.subject_head === "string" && src.subject_head.trim()) {
      const head = src.subject_head.trim();
      const number = src.subject_number === "복수" ? "복수" : "단수";
      let accept: string[] = Array.isArray(src.accept_subject)
        ? src.accept_subject
            .filter((s: any) => typeof s === "string" && s.trim())
            .map((s: string) => s.trim())
        : [];
      // accept_subject 는 반드시 subject_head 자체를 포함(관대한 채점의 핵심).
      if (!accept.includes(head)) accept = [head, ...accept];
      out.subject_head = head;
      out.subject_number = number;
      out.accept_subject = accept;
    }
    // 범주별 진단 필드: 최종 category에 맞는 것만 타입 검증 후 부착.
    // out은 매 밑줄 새로 만들고 화이트리스트 필드만 복사하므로, category와 안 맞는
    // 진단 필드는 여기서 부착되지 않고 자연히 탈락한다(문제 요구사항: 불일치 필드 drop).
    if (category === "준동사") {
      if (typeof src.has_object === "boolean") out.has_object = src.has_object;
    } else if (category === "관계사") {
      if (typeof src.clause_complete === "boolean") out.clause_complete = src.clause_complete;
    } else if (category === "형용사부사") {
      if (src.correct_pos === "부사" || src.correct_pos === "형용사") out.correct_pos = src.correct_pos;
    }
    return out;
  });

  // why_options: 정답 번호 문자열을 key로, 정확히 1개만 correct:true 로 강제(id 접두사 "g").
  const normalizeWhySet = (raw: any, prefix: string) => {
    const arr: any[] = Array.isArray(raw) ? raw : [];
    const items = arr
      .filter((o) => o && typeof o.label === "string" && o.label.trim())
      .map((o) => ({ label: o.label.trim(), correct: o.correct === true }));
    if (items.length === 0) return [] as { id: string; label: string; correct: boolean }[];
    let trueSeen = false;
    for (const it of items) {
      if (it.correct && !trueSeen) trueSeen = true;
      else it.correct = false;
    }
    if (!trueSeen) items[0].correct = true;
    return items.map((it, i) => ({ id: `${prefix}${i + 1}`, label: it.label, correct: it.correct }));
  };
  const answerKey = forcedAnswer != null ? String(forcedAnswer) : "";
  const rawWhy =
    parsed.why_options && typeof parsed.why_options === "object" ? parsed.why_options : {};
  // LLM은 정답 번호로 keying하지만, 다른 key로 왔으면 첫 배열을 폴백으로 채택.
  let rawWhyArr = rawWhy[answerKey];
  if (!Array.isArray(rawWhyArr)) {
    const firstKey = Object.keys(rawWhy)[0];
    rawWhyArr = firstKey ? rawWhy[firstKey] : [];
  }
  const why_options: Record<string, any[]> = answerKey
    ? { [answerKey]: normalizeWhySet(rawWhyArr, "g") }
    : {};

  // recovery: 범주 축(HIDDEN). 밑줄당 하나. category 는 위에서 정규화한 underlines 값과 정합,
  // is_grammatical = (num !== answer) 강제(정답 밑줄만 false), target 은 LLM 서술.
  const rawRecItems: any[] = Array.isArray(parsed.recovery?.items) ? parsed.recovery.items : [];
  const recByNum = new Map<number, any>();
  for (const it of rawRecItems) {
    if (it && typeof it.num === "number") recByNum.set(it.num, it);
  }
  const recovery = {
    axis: "category" as const,
    items: underlines.map((u) => {
      const src = recByNum.get(u.num) ?? {};
      return {
        num: u.num,
        target: typeof src.target === "string" ? src.target.trim() : "",
        category: u.category, // 밑줄과 동일 범주로 정합
        is_grammatical: forcedAnswer != null ? u.num !== forcedAnswer : u.is_correct,
      };
    }),
  };

  return {
    type: "grammar" as const,
    answer: forcedAnswer,
    combination: false,
    underlines,
    why_options,
    recovery,
    note: typeof parsed.note === "string" ? parsed.note : "",
    model: ACTUAL_MODEL,
    provider: ACTUAL_PROVIDER,
    provenance_verified: true,
  };
}

// ── 어휘(vocab) rubric ──────────────────────────────────────────────────────
// 형식 A(4문제): 지문에 (1)word … (5)word 밑줄 → choices = 밑줄 단어(정답), answer = 문맥상 부적절한 밑줄 번호.
// 형식 B(1문제): "조합형" — choices가 "widen … close-knit … frequently"처럼 생략부호(…)를 포함하거나
//   지문에 (\d) 밑줄 마커가 없음 → LLM 호출 없이 최소 rubric 반환(클라이언트가 폴백).
const VOCAB_POLARITY = ["+", "-"];
const VOCAB_INTRO = ["주장", "배경", "통념"];

// 조합형(combination) 판별: 어떤 선지에 생략부호가 있거나, 지문에 (\d) 밑줄 마커가 0개.
function isCombinationVocab(passage: string, choices: string[]): boolean {
  const hasEllipsisChoice = (choices ?? []).some(
    (c) => typeof c === "string" && (c.includes("…") || c.includes("...")),
  );
  const underlineCount = (String(passage ?? "").match(/\(\s*\d+\s*\)/g) ?? []).length;
  return hasEllipsisChoice || underlineCount === 0;
}

const buildVocabPrompt = (
  passage: string,
  choices: string[],
  answer: number | null,
) => {
  const choiceList = (choices ?? []).map((c, i) => `(${i + 1}) ${c}`).join("\n");
  const answerLine = answer != null ? `${answer}번` : "미상 — 지문 근거로 추론";
  const answerKey = answer != null ? String(answer) : "N";
  const answerTemplateNum = answer != null ? answer : 0;
  return `당신은 수능 영어 '어휘(문맥상 부적절한 낱말)' 문제의 형성평가 채점키(rubric)를 만드는 전문가입니다.
학생이 "글의 부호(±) 파악 → 밑줄 '문장'의 부정어까지 읽고 충돌 판단"을 하도록 유도하는 채점키를 JSON으로 생성하세요.

# 채점 철학 (교사의 실제 풀이법)
1. 소재·서론 유형 판단: 첫 문장부터 읽으며 주장/배경/통념 중 무엇인지, 글의 소재가 무엇인지 파악.
   (1~2번 밑줄은 보통 정답이 아니므로 소재 파악용으로 읽는다.)
2. 글 전체 부호(±): 글의 방향이 긍정(+)인지 부정(−)인지.
3. 각 밑줄 "문장"을 읽고 충돌 판단 — 밑줄 단어만 보지 말 것:
   - 밑줄 문장에 부정어(not, never, cannot, hardly, no, without, rarely 등)가 있으면,
     글이 +여도 그 밑줄 자리는 −여야 자연스러울 수 있음(반대도 마찬가지).
   - 즉 "글 부호 vs 밑줄 단어 부호"를 단순 비교하지 말고, 밑줄이 든 문장 전체의 논리로
     expected_polarity(그 자리에 와야 자연스러운 부호)를 정하라. 단어만 보고 정하지 말 것.

[지문] — (1)~(${choices.length}) 밑줄 표시 포함
${passage}

[밑줄 목록] — 이 번호/순서/단어를 그대로 사용하세요. (총 ${choices.length}개)
${choiceList}
[정답(문맥상 부적절한 낱말)] ${answerLine}   ← 이 번호가 확정된 정답입니다. 이 밑줄 하나만 is_correct:false 로 하세요.

# 생성 규칙
1) passage_polarity — 글 전체 방향. "+" 또는 "-" 중 하나만.
2) topic — 글의 소재 한 줄(한국어).
3) intro_type — 서론 유형 하나: "주장" | "배경" | "통념".
4) underlines — 위 [밑줄 목록]의 모든 밑줄에 대해 각각:
   - num: 1-based 번호(밑줄 목록 순서 그대로).
   - word: 그 밑줄의 표현(밑줄 목록의 단어 그대로).
   - sentence_has_negation: 그 밑줄이 든 '문장'에 부정어(not/never/cannot/hardly/no/without/rarely 등)가
     있으면 true, 없으면 false. 반드시 판단하라(이 문제의 핵심). 단어가 아니라 문장을 보라.
   - expected_polarity: 그 자리에 와야 자연스러운 부호("+" 또는 "-"). 반드시 밑줄이 든 문장 전체의
     논리로 정하라. 부정어가 있으면 글 부호와 반대가 될 수 있다.
   - is_correct: 문맥상 적절하면 true, 부적절한 밑줄(=정답)만 false. 정확히 정답 밑줄 1개만 false.
   - why: 맞으면 왜 그 단어가 문맥에 맞는지 / 틀리면 어떤 단어로 바꿔야 하는지 한 줄
     (예: 'reversals가 아니라 spurts(급성장)여야 함').
5) why_options — 정답 밑줄(${answerLine})에 대해서만, 학생이 "왜 이게 틀렸어요?"에 버튼으로 답할 이유 후보 3개.
   정확히 3개 chip, 그 중 1개만 correct:true. 순서/어법 문제의 원칙과 동일:
   - correct:true 1개 = 진짜 '단서'(결론·정답번호 나열 금지). 예: '글은 +인데 이 자리만 -단어라서',
     '이 문장에 부정어가 있어서 -가 맞는데 +단어라서'. 부호 충돌의 단서만 한 줄로.
   - correct:false = 그럴듯하지만 틀린 오개념. 예: '단어 자체가 어려워서', '앞 문장과 안 이어져서'.
   - correct:false = 감(感)·표면 기반. 예: '느낌상 어색해서'.
   key는 정답 번호 문자열("${answerKey}"), 각 chip id는 'v1','v2','v3'. label은 약 30자 이내 한국어.
6) note — 학생이 부정어를 놓쳐 헷갈릴 밑줄과 그 이유 한 줄.
7) recovery — 【복구 진단 전용·화면 노출 금지】 각 밑줄의 극성 정합을 자기완결로 기술.
   axis 는 항상 "polarity". items 는 밑줄마다 하나([밑줄 목록]의 모든 밑줄을 num 오름차순으로):
   - num: 1-based 번호(밑줄 목록 순서 그대로).
   - sentence_polarity: 그 밑줄이 '든 문장'이 나타내는 부호("+" 또는 "-").
     밑줄 단어만 보지 말고 문장 전체(부정어 포함)의 논리로 정하라.
   - word_polarity: 그 밑줄 '낱말 자체'가 이 지문 맥락에서 실제로 띠는 부호("+" 또는 "-").
     ⚠️ 사전적 부호가 아니라 이 문맥에서의 실제 함의(contextual valence)로 정하라 — 오류가 잦은 축이니 특히 신중히.
   - fits: 그 낱말이 글의 방향에 부합하면 true, 충돌하면 false(정답 낱말만 유일하게 충돌).

# 출력
아래 JSON 객체만 출력하세요. 설명·코드펜스 금지.
※ string 값 안에서 영어 어구를 인용할 때는 큰따옴표(")를 쓰지 말고 작은따옴표(')만 사용하세요.
   JSON 문법을 깨는, 이스케이프되지 않은 큰따옴표를 문자열 값 안에 절대 넣지 마세요.
{"answer":${answerTemplateNum},"passage_polarity":"","topic":"","intro_type":"","underlines":[{"num":1,"word":"","sentence_has_negation":false,"expected_polarity":"","is_correct":true,"why":""}],"why_options":{"${answerKey}":[{"id":"v1","label":"","correct":true},{"id":"v2","label":"","correct":false},{"id":"v3","label":"","correct":false}]},"recovery":{"axis":"polarity","items":[{"num":1,"sentence_polarity":"+","word_polarity":"+","fits":true}]},"note":""}`;
};

// 독립 재사용 함수: 지문/선지/정답 → 어휘 채점키 rubric 객체 (claude-sonnet-5 고정)
export async function generateVocabRubric(
  passage: string,
  choices: string[],
  answer: number | null,
  opts: { gatewayKey: string },
) {
  // 조합형(combination) 서브타입: LLM 호출 없이 최소 rubric 반환(클라이언트 폴백).
  if (isCombinationVocab(passage, choices)) {
    return {
      type: "vocab" as const,
      combination: true,
      answer: typeof answer === "number" ? answer : null,
      passage_polarity: "+" as const,
      underlines: [] as any[],
      why_options: {} as Record<string, any[]>,
      recovery: { axis: "polarity" as const, items: [] as any[] },
      topic: "",
      intro_type: "주장" as const,
      note: "",
      model: ACTUAL_MODEL,
      provider: ACTUAL_PROVIDER,
      provenance_verified: true,
    };
  }

  const vocabPrompt = buildVocabPrompt(passage, choices, answer);
  // 게이트웨이가 이스케이프 안 된 큰따옴표로 깨진 JSON을 뱉으면 1회 재시도.
  let parsed: any;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    // 프로바이더 라우팅은 callChat 이 담당(LLM_PROVIDER 로 openai↔gateway 전환).
    // underlines 5개 + why_options → 넉넉히 상향(순서·어법 브랜치와 동일).
    const { status, data, content } = await callChat(
      [
        { role: "system", content: "너는 정확한 JSON만 출력하는 채점키 생성기다." },
        { role: "user", content: vocabPrompt },
      ],
      { maxTokens: 4500 },
    );
    try {
      parsed = extractJson(content);
      break;
    } catch (e) {
      // 게이트웨이가 실제로 뭘 반환했는지 표면화(레이트리밋/쿼터/에러 바디는 non-JSON).
      lastErr = new Error(
        `vocab rubric parse fail (gw status ${status}): ${JSON.stringify(data).slice(0, 500)}`,
      );
    }
  }
  if (parsed === undefined) throw lastErr;

  // ── NORMALIZE ──
  // answer 는 제공된 정답을 우선(ground truth). 없으면 파싱값.
  const forcedAnswer =
    typeof answer === "number"
      ? answer
      : typeof parsed.answer === "number"
        ? parsed.answer
        : null;

  // passage_polarity: {+,-} 만 허용. 아니면 "+".
  const passage_polarity = VOCAB_POLARITY.includes(parsed.passage_polarity)
    ? parsed.passage_polarity
    : "+";
  const topic = typeof parsed.topic === "string" ? parsed.topic : "";
  const intro_type = VOCAB_INTRO.includes(parsed.intro_type) ? parsed.intro_type : "주장";

  // 파싱된 밑줄을 num으로 인덱싱.
  const parsedUnderlines: any[] = Array.isArray(parsed.underlines) ? parsed.underlines : [];
  const byNum = new Map<number, any>();
  for (const u of parsedUnderlines) {
    if (u && typeof u.num === "number") byNum.set(u.num, u);
  }

  // underlines: choices와 1:1. num=i+1, word=choices[i] 강제(ground truth).
  // is_correct: 정답 밑줄만 false, 나머지 true(정확히 1개 false 보장).
  // sentence_has_negation: 항상 boolean으로 확정. expected_polarity: {+,-} 강제.
  const underlines = (choices ?? []).map((w: string, i: number) => {
    const num = i + 1;
    const src = byNum.get(num) ?? {};
    const isCorrect =
      forcedAnswer != null ? num !== forcedAnswer : src.is_correct !== false;
    return {
      num,
      word: w, // ground truth: LLM word 무시
      sentence_has_negation: src.sentence_has_negation === true,
      expected_polarity: VOCAB_POLARITY.includes(src.expected_polarity)
        ? src.expected_polarity
        : passage_polarity,
      is_correct: isCorrect,
      why: typeof src.why === "string" ? src.why : "",
    };
  });

  // why_options: 정답 번호 문자열을 key로, 정확히 1개만 correct:true 로 강제(id 접두사 "v").
  const normalizeWhySet = (raw: any, prefix: string) => {
    const arr: any[] = Array.isArray(raw) ? raw : [];
    const items = arr
      .filter((o) => o && typeof o.label === "string" && o.label.trim())
      .map((o) => ({ label: o.label.trim(), correct: o.correct === true }));
    if (items.length === 0) return [] as { id: string; label: string; correct: boolean }[];
    let trueSeen = false;
    for (const it of items) {
      if (it.correct && !trueSeen) trueSeen = true;
      else it.correct = false;
    }
    if (!trueSeen) items[0].correct = true;
    return items.map((it, i) => ({ id: `${prefix}${i + 1}`, label: it.label, correct: it.correct }));
  };
  const answerKey = forcedAnswer != null ? String(forcedAnswer) : "";
  const rawWhy =
    parsed.why_options && typeof parsed.why_options === "object" ? parsed.why_options : {};
  // LLM은 정답 번호로 keying하지만, 다른 key로 왔으면 첫 배열을 폴백으로 채택.
  let rawWhyArr = rawWhy[answerKey];
  if (!Array.isArray(rawWhyArr)) {
    const firstKey = Object.keys(rawWhy)[0];
    rawWhyArr = firstKey ? rawWhy[firstKey] : [];
  }
  const why_options: Record<string, any[]> = answerKey
    ? { [answerKey]: normalizeWhySet(rawWhyArr, "v") }
    : {};

  // recovery: 극성 축(HIDDEN). 밑줄당 하나. fits = (num !== answer) 강제(정답 낱말만 충돌),
  // sentence_polarity/word_polarity 는 {+,-} 로 강제(기본 passage_polarity), 나머지 LLM 판단.
  const rawRecItems: any[] = Array.isArray(parsed.recovery?.items) ? parsed.recovery.items : [];
  const recByNum = new Map<number, any>();
  for (const it of rawRecItems) {
    if (it && typeof it.num === "number") recByNum.set(it.num, it);
  }
  const recovery = {
    axis: "polarity" as const,
    items: (choices ?? []).map((_w: string, i: number) => {
      const num = i + 1;
      const src = recByNum.get(num) ?? {};
      return {
        num,
        sentence_polarity: VOCAB_POLARITY.includes(src.sentence_polarity)
          ? src.sentence_polarity
          : passage_polarity,
        word_polarity: VOCAB_POLARITY.includes(src.word_polarity)
          ? src.word_polarity
          : passage_polarity,
        fits: forcedAnswer != null ? num !== forcedAnswer : src.fits !== false,
      };
    }),
  };

  return {
    type: "vocab" as const,
    answer: forcedAnswer,
    combination: false,
    passage_polarity,
    topic,
    intro_type,
    underlines,
    why_options,
    recovery,
    note: typeof parsed.note === "string" ? parsed.note : "",
    model: ACTUAL_MODEL,
    provider: ACTUAL_PROVIDER,
    provenance_verified: true,
  };
}

// ── 삽입(sentence-insertion) rubric ─────────────────────────────────────────
// 형식(5문제): 지문에 ( ① ) … ( ⑤ ) 위치 표시 5개(괄호+공백+원문자). 삽입 문장은
//   별도 컬럼 insert_sentence(선지 아님; choices는 ['①'..'⑤']). answer = 정답 위치(1-5).
//   조합형 서브타입 없음 — 5개 모두 표준.
const buildInsertPrompt = (
  passage: string,
  insertSentence: string,
  answer: number | null,
) => {
  const answerLine = answer != null ? `${answer}번 위치` : "미상 — 지문 근거로 추론";
  const answerTemplateNum = answer != null ? answer : 0;
  // 오답 위치(정답 아닌 1-5) 목록 — distractor_traps 키 안내용.
  const wrongPositions = [1, 2, 3, 4, 5].filter((n) => n !== answer);
  const wrongList = wrongPositions.join(", ");
  return `당신은 수능 영어 '문장 삽입' 문제의 형성평가 채점키(rubric)를 만드는 전문가입니다.
학생이 답을 "고르고 끝내지 않고", 5단계 절차(①소재 파악 ②삽입 문장 분석 ③슬롯 소거 스캔
④답 확정·자기 언어 정리 ⑤오답 회복)로 스스로 근거를 세우도록 유도하는 채점키를 JSON으로 생성하세요.

# 채점 철학 (교사의 실제 풀이법)
- 정답 위치를 맞히는 게 아니라, "왜 거기가 맞는지"를 [앞 문장 → 삽입 문장 → 뒤 문장]의
  지시어·연결사·반복어·논리 흐름으로 설명할 수 있어야 함.
- 정답 위치에 넣으면: 삽입 문장이 앞 문장을 자연스럽게 이어받고(앞연결), 뒤 문장이 삽입 문장을
  자연스럽게 이어받음(뒤연결). 이 두 연결이 모두 성립하는 자리가 정답이다.
- 오답 위치에 넣으면: 앞연결 또는 뒤연결 중 하나가 끊어진다(지시어가 가리킬 대상이 없거나,
  원래 이어지던 두 문장 사이를 삽입 문장이 억지로 끊음 등).
- 대부분의 삽입 지문은 정확히 2개 개념을 대조·병치한다(예: Aristotelian idealization vs
  Galilean idealization). 삽입 문장은 보통 두 번째 개념을 도입하며, 앞을 가리키는 단서(지시어·연결사)로
  첫 번째 개념 설명 뒤에 붙는다.

[지문] — 위치 표시 ( ① ) ~ ( ⑤ ) 포함
${passage}

[삽입 문장]
${insertSentence}

[정답 위치] ${answerLine}   ← 이 위치가 확정된 정답입니다. 이 위치를 근거로 채점키를 만드세요.
[오답 위치] ${wrongList}

# 생성 규칙 (5단계)
1) topic — 【Phase 1: 소재 파악】 지문 첫 2~3문장의 소재를 채점하는 구조체. 아래 6필드 모두 채우세요.
   빈칸 문제의 topic과 완전히 동일한 형식입니다.
   - canonical: 가장 대표적인 정답 소재(한국어 한 줄).
   - accept: 방향이 맞는 소재 표현들(canonical 동의어·부분표현 포함). **최소 3개**.
   - reject_too_narrow: 소재를 세부로 지나치게 좁힌 표현들. **최소 2개**.
   - reject_too_broad: 상위어·지나치게 포괄적 표현들(예: 과학, 인간, 삶). **최소 2개**.
   - reject_wrong: 방향이 틀린 표현들. **최소 2개**.
   - note: 이 소재를 어떻게 채점해야 하는지 한 줄 메모.
   ※ 어떤 배열도 비워두지 마세요.
2) concept_count — 【Phase 1】 이 글이 대조·병치하는 서로 다른 개념의 수. 정수 2 | 3 | 4 중 하나.
   대부분의 삽입 지문은 정확히 2개(예: 아리스토텔레스적 vs 갈릴레이적)를 대조합니다. 지문에서 세어보세요.
3) insertion_sentence — 【Phase 2: 삽입 문장 분석】 [삽입 문장]을 분석한 객체.
   - has_anaphor: 삽입 문장에 앞을 가리키는 단서가 있으면 true. 지시어(this/these/it/the statement/such 등)
     또는 연결사(however/on the other hand/thus/therefore/instead/in contrast 등)가 있으면 true.
   - anaphor_expression: 그 단서 표현(원문 그대로, 예: 'on the other hand', 'This'). 없으면 "".
   - anaphor_type: 그 단서가 '앞 내용'과 맺는 관계. "contrast"(반대) | "similar"(비슷) | "cause"(원인) 중 하나.
     (however/on the other hand/but/in contrast → contrast / also/likewise/similarly → similar /
      thus/therefore/so/as a result → cause)
   - expected_prior_content: 삽입 문장 바로 '앞'에 반드시 나와야 할 내용(fill-in 채점용 구조체).
     · canonical: 그 앞 내용을 한 줄로(한국어, 지문 용어 섞어서). 예: '아리스토텔레스적 이상화 설명'.
     · accept: 그 내용을 가리키는 동의어·키워드 배열(한국어+지문에 실제로 나온 영어 용어 섞어서).
       예: ['Aristotelian', '아리스토텔레스', '이상화', 'idealization']. **최소 2개**.
   ※ 앞을 가리키는 단서가 정말 없으면 has_anaphor:false, anaphor_expression:"" 로 두되,
     anaphor_type 은 논리상 가장 맞는 관계로, expected_prior_content 는 논리로 채우세요.
4) slot_fit — 【Phase 3: 슬롯 소거 스캔】 슬롯 1~5 각각에 삽입 문장을 넣어봤을 때 자연스러운지.
   정확히 5개, slot 오름차순. fit:true 는 정확히 1개(= 정답 위치 ${answerTemplateNum}), 나머지 fit:false.
   - slot: 1..5.
   - fit: 정답 위치만 true, 나머지 false.
   - why: 그 자리가 왜 자연스러운지/어색한지 한 줄(화면 노출 금지·채점 전용).
     오답 슬롯은 앞연결 또는 뒤연결 중 무엇이 끊기는지 쓰세요.
5) reasoning_keywords — 【Phase 4: 답 확정·자기 언어 정리】 정답 슬롯이 왜 맞는지를 요약하는
   짧은 키워드 구 3~6개(앵커 단서 + 앞/뒤 개념). 학생의 한 줄 이유와 관대하게 overlap 비교하는 캐시.
   예: ['Aristotelian 설명 뒤', '대조', 'on the other hand', 'Galilean 도입'].
6) concepts — 【Phase 5: 오답 회복】 이 지문이 대조·병치하는 '주요' 개념 목록(문자열 배열).
   정확히 concept_count개(위 concept_count 와 같은 수, 대부분 2개).
   각 항목은 지문에 '실제로 등장하는' 짧은 용어(1~3단어)로 이름 붙이세요.
   예: ['Aristotelian idealization', 'Galilean idealization']. 지저분한 슬롯별 설명이 아니라,
   깨끗한 '개념 집합'이어야 합니다. 이 목록이 Phase 5b 버튼으로 학생에게 노출됩니다.
7) slot_diagnostics — 【Phase 5: 오답 회복】 각 슬롯 '바로 뒤 문장'이 위 concepts 중 어느 개념에 속하는지.
   정확히 5개, slot 오름차순. following_sentence_concept 는 반드시 concepts 배열의 값 '중 하나와 정확히
   일치'해야 합니다(자유 서술 금지, 새 라벨 생성 금지). "슬롯 N 뒤 문장은 어떤 개념?" 회복용.
8) connection_cues — 정답 위치(${answerLine})에서의 앞뒤 연결 단서. 두 필드 모두 반드시 비어있지 않게.
   - 앞연결: 정답 위치의 '앞 문장'과 '삽입 문장'을 잇는 단서(지시어/연결사/반복어) 한 줄.
     예: '삽입 문장의 on the other hand가 앞의 Aristotelian idealization과 대조됨'.
   - 뒤연결: '삽입 문장'과 정답 위치의 '뒤 문장'을 잇는 단서 한 줄.
     예: '삽입 문장이 소개한 Galilean idealization을 뒤 문장이 이어서 설명함'.
9) distractor_traps — 오답 위치(${wrongList} 중 2~3개)에 대해, 그 자리에 넣으면 앞 또는 뒤가 왜
   어색해지는지 한 줄씩. 키는 위치 번호 문자열("1"~"5")이며, 절대 정답 위치(${answerTemplateNum})를
   키로 쓰지 마세요. 예: {"2":"거기 넣으면 삽입 문장의 지시어가 가리킬 대상이 아직 안 나와 앞연결이 끊김"}.
10) check_questions — 학생에게 던질 검증 질문 2~3개(문자열 배열).
   예: '삽입 문장의 on the other hand는 앞 문장과 대조되나요?',
       '삽입 문장 다음이 원래 뒤 문장과 자연스럽게 이어지나요?'.
11) note — 이 문제에서 학생이 특히 헷갈릴 위치와 그 이유 한 줄.

# 출력
아래 JSON 객체만 출력하세요. 설명·코드펜스 금지.
※ string 값 안에서 영어 어구를 인용할 때는 큰따옴표(")를 쓰지 말고 작은따옴표(')만 사용하세요.
   JSON 문법을 깨는, 이스케이프되지 않은 큰따옴표를 문자열 값 안에 절대 넣지 마세요.
{"answer":${answerTemplateNum},"topic":{"canonical":"","accept":[],"reject_too_narrow":[],"reject_too_broad":[],"reject_wrong":[],"note":""},"concept_count":2,"insertion_sentence":{"has_anaphor":true,"anaphor_expression":"","anaphor_type":"contrast","expected_prior_content":{"canonical":"","accept":[]}},"slot_fit":[{"slot":1,"fit":false,"why":""},{"slot":2,"fit":false,"why":""},{"slot":3,"fit":false,"why":""},{"slot":4,"fit":false,"why":""},{"slot":5,"fit":false,"why":""}],"reasoning_keywords":[],"concepts":["Aristotelian idealization","Galilean idealization"],"slot_diagnostics":[{"slot":1,"following_sentence_concept":"Aristotelian idealization"},{"slot":2,"following_sentence_concept":"Aristotelian idealization"},{"slot":3,"following_sentence_concept":"Aristotelian idealization"},{"slot":4,"following_sentence_concept":"Galilean idealization"},{"slot":5,"following_sentence_concept":"Galilean idealization"}],"connection_cues":{"앞연결":"","뒤연결":""},"distractor_traps":{"${wrongPositions[0] ?? 1}":"","${wrongPositions[1] ?? 2}":""},"check_questions":["",""],"note":""}`;
};

// 독립 재사용 함수: 지문/삽입문장/정답 → 삽입 채점키 rubric 객체 (claude-sonnet-5 고정)
export async function generateInsertRubric(
  passage: string,
  insertSentence: string,
  answer: number | null,
  opts: { gatewayKey: string },
) {
  const insertPrompt = buildInsertPrompt(passage, insertSentence ?? "", answer);
  // 게이트웨이가 이스케이프 안 된 큰따옴표로 깨진 JSON을 뱉으면 1회 재시도.
  let parsed: any;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    // 프로바이더 라우팅은 callChat 이 담당(LLM_PROVIDER 로 openai↔gateway 전환).
    // topic(6버킷) + insertion_sentence + slot_fit(5) + slot_diagnostics(5) + reasoning_keywords
    // + connection_cues + distractor_traps + check_questions → 출력이 커져 6000으로 상향.
    const { status, data, content } = await callChat(
      [
        { role: "system", content: "너는 정확한 JSON만 출력하는 채점키 생성기다." },
        { role: "user", content: insertPrompt },
      ],
      { maxTokens: 6000 },
    );
    try {
      parsed = extractJson(content);
      break;
    } catch (e) {
      // 게이트웨이가 실제로 뭘 반환했는지 표면화(레이트리밋/쿼터/에러 바디는 non-JSON).
      lastErr = new Error(
        `insert rubric parse fail (gw status ${status}): ${JSON.stringify(data).slice(0, 500)}`,
      );
    }
  }
  if (parsed === undefined) throw lastErr;

  // ── NORMALIZE ──
  // answer 는 제공된 정답을 우선(ground truth). 없으면 파싱값(1-5로 클램프).
  const parsedAnswer =
    typeof parsed.answer === "number" && parsed.answer >= 1 && parsed.answer <= 5
      ? parsed.answer
      : null;
  const forcedAnswer =
    typeof answer === "number" && answer >= 1 && answer <= 5 ? answer : parsedAnswer;

  // ── Phase 1: topic — 빈칸과 동일한 5버킷 구조체로 강제(배열은 [] 기본). ──
  const strArr = (v: any): string[] =>
    Array.isArray(v) ? v.filter((s: any) => typeof s === "string" && s.trim()).map((s: string) => s.trim()) : [];
  const rawTopic = parsed.topic && typeof parsed.topic === "object" ? parsed.topic : {};
  const topic = {
    canonical: typeof rawTopic.canonical === "string" ? rawTopic.canonical.trim() : "",
    accept: strArr(rawTopic.accept),
    reject_too_narrow: strArr(rawTopic.reject_too_narrow),
    reject_too_broad: strArr(rawTopic.reject_too_broad),
    reject_wrong: strArr(rawTopic.reject_wrong),
    note: typeof rawTopic.note === "string" ? rawTopic.note.trim() : "",
  };

  // ── Phase 1: concept_count — {2,3,4} 정수로 강제(범위 밖·결측이면 2). ──
  const rawConceptCount =
    typeof parsed.concept_count === "number" ? Math.round(parsed.concept_count) : NaN;
  const concept_count = [2, 3, 4].includes(rawConceptCount) ? rawConceptCount : 2;

  // ── Phase 2: insertion_sentence — has_anaphor boolean, anaphor_type ∈ {contrast,similar,cause}
  //    (기본 contrast), expected_prior_content → {canonical:string, accept:string[]}. ──
  const rawIns =
    parsed.insertion_sentence && typeof parsed.insertion_sentence === "object"
      ? parsed.insertion_sentence
      : {};
  const ANAPHOR_TYPES = ["contrast", "similar", "cause"];
  const rawPrior =
    rawIns.expected_prior_content && typeof rawIns.expected_prior_content === "object"
      ? rawIns.expected_prior_content
      : {};
  const insertion_sentence = {
    has_anaphor: rawIns.has_anaphor === true,
    anaphor_expression:
      typeof rawIns.anaphor_expression === "string" ? rawIns.anaphor_expression.trim() : "",
    anaphor_type: ANAPHOR_TYPES.includes(rawIns.anaphor_type) ? rawIns.anaphor_type : "contrast",
    expected_prior_content: {
      canonical: typeof rawPrior.canonical === "string" ? rawPrior.canonical.trim() : "",
      accept: strArr(rawPrior.accept),
    },
  };

  // ── Phase 3: slot_fit — 정확히 5개(slot 1..5). fit = (slot===answer) 로 강제(정답이 ground truth).
  //    이로써 fit:true 는 정확히 1개 == answer 가 불변식으로 보장된다. why 는 LLM 값 유지(폴백 문구). ──
  const rawFit: any[] = Array.isArray(parsed.slot_fit) ? parsed.slot_fit : [];
  const fitBySlot = new Map<number, any>();
  for (const f of rawFit) {
    if (f && typeof f.slot === "number") fitBySlot.set(f.slot, f);
  }
  const slot_fit = [1, 2, 3, 4, 5].map((slot) => {
    const src = fitBySlot.get(slot) ?? {};
    const why =
      typeof src.why === "string" && src.why.trim()
        ? src.why.trim()
        : slot === forcedAnswer
          ? "이 자리에서 앞연결·뒤연결이 모두 성립합니다."
          : "이 자리에 넣으면 앞연결 또는 뒤연결이 끊깁니다.";
    return { slot, fit: forcedAnswer != null ? slot === forcedAnswer : false, why };
  });

  // ── Phase 4: reasoning_keywords — 트림된 비어있지 않은 문자열 배열(기본 []). ──
  const reasoning_keywords = strArr(parsed.reasoning_keywords);

  // ── Phase 5: concepts — 지문의 주요 대비 개념 목록. 트림된 비어있지 않은 문자열 배열.
  //    없으면 []로 폴백(발명 금지). 이상적으로는 length == concept_count 이나 강제하지 않음. ──
  const concepts = strArr(parsed.concepts);

  // ── Phase 5: slot_diagnostics — 정확히 5개(slot 1..5). following_sentence_concept 는 concepts 중
  //    하나에 스냅. 정확히 일치하지 않으면 대소문자 무시 substring overlap 으로 가장 가까운 concepts
  //    항목에 스냅. overlap 이 전혀 없고 concepts 가 비어있지 않으면 모델 값을 그대로 둔다(폴백). ──
  const rawDiag: any[] = Array.isArray(parsed.slot_diagnostics) ? parsed.slot_diagnostics : [];
  const diagBySlot = new Map<number, any>();
  for (const d of rawDiag) {
    if (d && typeof d.slot === "number") diagBySlot.set(d.slot, d);
  }
  const snapToConcept = (value: string): string => {
    if (!concepts.length) return value; // 스냅할 대상 없음
    if (concepts.includes(value)) return value; // 이미 정확히 일치
    const lower = value.toLowerCase();
    let best: string | null = null;
    let bestLen = 0;
    for (const c of concepts) {
      const cl = c.toLowerCase();
      // 어느 한쪽이 다른 쪽을 포함하면 overlap 으로 간주. 가장 긴 개념명을 우선.
      if ((lower && cl.includes(lower)) || (cl && lower.includes(cl))) {
        if (cl.length >= bestLen) {
          best = c;
          bestLen = cl.length;
        }
      }
    }
    return best ?? value; // overlap 없으면 모델 값 유지(폴백)
  };
  const slot_diagnostics = [1, 2, 3, 4, 5].map((slot) => {
    const src = diagBySlot.get(slot) ?? {};
    const raw =
      typeof src.following_sentence_concept === "string"
        ? src.following_sentence_concept.trim()
        : "";
    return {
      slot,
      following_sentence_concept: snapToConcept(raw),
    };
  });

  // connection_cues: {앞연결, 뒤연결} 문자열로 강제. 비면 안전한 폴백 문구.
  const rawCues =
    parsed.connection_cues && typeof parsed.connection_cues === "object"
      ? parsed.connection_cues
      : {};
  const frontRaw = typeof rawCues["앞연결"] === "string" ? rawCues["앞연결"].trim() : "";
  const backRaw = typeof rawCues["뒤연결"] === "string" ? rawCues["뒤연결"].trim() : "";
  const connection_cues = {
    앞연결: frontRaw || "정답 위치의 앞 문장과 삽입 문장을 잇는 지시어·연결사·반복어를 확인하세요.",
    뒤연결: backRaw || "삽입 문장과 뒤 문장이 논리적으로 이어지는지 확인하세요.",
  };

  // distractor_traps: 위치 번호 문자열("1".."5")을 키로, 값은 문자열. 정답 위치 키는 제거.
  const rawTraps =
    parsed.distractor_traps && typeof parsed.distractor_traps === "object"
      ? parsed.distractor_traps
      : {};
  const distractor_traps: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawTraps)) {
    const pos = parseInt(String(k).replace(/[^0-9]/g, ""), 10);
    if (!Number.isInteger(pos) || pos < 1 || pos > 5) continue; // 1-5 위치만
    if (forcedAnswer != null && pos === forcedAnswer) continue; // 정답 위치는 오답 트랩이 아님
    if (typeof v === "string" && v.trim()) distractor_traps[String(pos)] = v.trim();
  }

  // check_questions: 학생에게 던질 검증 질문(문자열 배열). 기본 [].
  const check_questions = Array.isArray(parsed.check_questions)
    ? parsed.check_questions.filter((q: any) => typeof q === "string" && q.trim()).map((q: string) => q.trim())
    : [];

  return {
    type: "insert" as const,
    answer: forcedAnswer,
    // Phase 1
    topic,
    concept_count,
    // Phase 2
    insertion_sentence,
    // Phase 3
    slot_fit,
    // Phase 4
    reasoning_keywords,
    // Phase 5
    concepts,
    slot_diagnostics,
    // 기존 유지(챗 유도 재료)
    connection_cues,
    distractor_traps,
    check_questions,
    note: typeof parsed.note === "string" ? parsed.note : "",
    model: ACTUAL_MODEL,
    provider: ACTUAL_PROVIDER,
    provenance_verified: true,
  };
}

// ── 무관(irrelevant-sentence / omit) rubric ─────────────────────────────────
// 형식(5문제): 지문에 (1)…(5) ASCII 괄호 숫자 마커로 5개 문장 표시. choices = ['1'..'5'],
//   answer = 글 흐름과 무관한(빼야 하는) 문장 번호. insert_sentence 없음. 삽입의 거울상 —
//   학생은 '고르고 끝내지' 말고 후보 문장을 '빼보고' 앞뒤가 이어지는지·주제와 무관한지 검증.
const OMIT_INTRO_TYPES = ["통념", "주장", "배경지식", "통념반박", "기타"];

const buildOmitPrompt = (passage: string, answer: number | null) => {
  const answerLine = answer != null ? `${answer}번 문장` : "미상 — 지문 근거로 추론";
  const answerTemplateNum = answer != null ? answer : 0;
  // 오답(정답 아닌 1-5) 문장 번호 — trap_sentences 키 안내용.
  const relevantNums = [1, 2, 3, 4, 5].filter((n) => n !== answer);
  const relevantList = relevantNums.join(", ");
  // 정답 자리에 relevant:false 를 심은 예시 배열(나머지는 relevant:true).
  const relevanceTemplate = [1, 2, 3, 4, 5]
    .map((n) => `{"num":${n},"relevant":${answer != null ? n !== answer : n !== 4},"why":""}`)
    .join(",");
  const trapKey1 = relevantNums[0] ?? 1;
  const trapKey2 = relevantNums[1] ?? 2;
  return `당신은 수능 영어 '무관한 문장 고르기' 문제의 형성평가 채점키(rubric)를 만드는 전문가입니다.
학생이 답을 "고르고 끝내지 않고", 후보 문장을 실제로 '빼보고' [앞 문장 → 뒤 문장]이
자연스럽게 이어지는지, 그 문장이 글의 주제와 무관한지 스스로 검증하도록 유도하는 채점키를 JSON으로 생성하세요.

# 채점 철학 (교사의 실제 풀이법 — 삽입의 거울상)
- 무관 문장은 '빼면' 앞뒤가 자연스럽게 이어지고, 글의 주제·흐름과 무관합니다.
- 나머지 문장들은 각자 글의 주제·흐름에 '기여'하므로 빼면 오히려 글이 어색해집니다.
- 정답 문장만 맞히는 게 아니라, "왜 그 문장이 무관한지"를 '빼봤을 때의 흐름'으로 설명할 수 있어야 함.
- 함정: 관련 있어 '보이지만' 실은 주제에 기여하는 문장(같은 소재의 단어가 나와 헷갈림)을 학생이
  성급히 무관하다고 고르지 않게 해야 합니다.

[지문] — 문장 번호 표시 (1) ~ (5) 포함
${passage}

[정답(무관한 문장)] ${answerLine}   ← 이 문장이 확정된 정답입니다. 이 문장을 근거로 채점키를 만드세요.
[나머지(주제에 기여하는) 문장] ${relevantList}

# 생성 규칙
1) topic — 지문의 소재를 채점하는 구조체. 빈칸 문제의 topic과 완전히 동일한 6필드 형식.
   - canonical: 가장 대표적인 정답 소재(한국어 한 줄).
   - accept: 방향이 맞는 소재 표현들(canonical 동의어·부분표현 포함). **최소 3개**.
   - reject_too_narrow: 소재를 세부로 지나치게 좁힌 표현들. **최소 2개**.
   - reject_too_broad: 상위어·지나치게 포괄적 표현들(예: 과학, 인간, 삶). **최소 2개**.
   - reject_wrong: 방향이 틀린 표현들. **최소 2개**.
   - note: 이 소재를 어떻게 채점해야 하는지 한 줄 메모.
   ※ 어떤 배열도 비워두지 마세요.
2) intro_type — 서론 유형 하나: "통념" | "주장" | "배경지식" | "통념반박" | "기타".
3) sentence_relevance — 【스캔 단계용】 5개 문장 (1)~(5) 각각이 글의 주제·흐름에 기여하는지 전부 판단.
   정확히 5개, num 오름차순. relevant:false 는 정확히 1개(= 정답 ${answerTemplateNum}), 나머지 relevant:true.
   - num: 1..5.
   - relevant: 그 문장이 주제·흐름에 기여하면 true, 무관하면 false(정답 문장만 false).
   - why: 그 문장이 주제에 '어떻게 기여하는지'(true) 또는 '왜 무관한지'(false) 한 줄(화면 노출 금지·채점 전용).
4) why_unrelated — 정답 문장이 글의 주제와 무관한 이유 한 줄.
5) flow_without — 정답 문장을 '빼면' 그 앞 문장과 뒤 문장이 어떻게 자연스럽게 이어지는지 한 줄.
6) trap_sentences — 학생이 그 문장을 '무관한 문장'으로 잘못 골랐을 때 보여줄 진단 한 줄.
   값은 (a) 그 문장이 실제로 글에서 하는 역할(왜 무관이 아니라 주제에 기여하는지)을 짚고,
   (b) 진짜 정답 쪽으로 방향을 다시 잡아주는, 학생에게 말하는 톤의 한 문장이어야 합니다.
   - 반드시 한 문장. 과제 수준의 담백한 톤(감정 위로·"아쉬워요" 류 금지).
   - 관련 있어 '보여서' 가장 헷갈리는(= 학생이 오답으로 고르기 쉬운) 오답 문장 2~3개만 다루세요.
   - 키는 문장 번호 문자열("1"~"5"), 절대 정답 번호(${answerTemplateNum})를 키로 쓰지 마세요.
   예시(스타일 참고):
     · 통념반박 지문에서 함정이 '반박당하는 통념' 문장이면:
       "그건 반박당하는 통념이라 무관이 아니에요 — 전환점 뒤를 보세요."
     · 헷갈리는 두 개념이 있으면(예: 회피 vs 선택적 주의):
       "회피랑 선택적 주의를 헷갈렸네요 — 둘 다 '안 본다'지만 메커니즘이 달라요."
7) check_questions — 학생에게 던질 검증 질문 2~3개(문자열 배열).
   예: '그 문장을 빼도 앞뒤가 자연스럽게 이어지나요?', '그 문장이 글 전체 주제와 관련이 있나요, 딴 얘기인가요?'.
8) note — 이 문제에서 학생이 특히 헷갈릴 문장과 그 이유 한 줄.

# 출력
아래 JSON 객체만 출력하세요. 설명·코드펜스 금지.
※ string 값 안에서 영어 어구를 인용할 때는 큰따옴표(")를 쓰지 말고 작은따옴표(')만 사용하세요.
   JSON 문법을 깨는, 이스케이프되지 않은 큰따옴표를 문자열 값 안에 절대 넣지 마세요.
{"answer":${answerTemplateNum},"topic":{"canonical":"","accept":[],"reject_too_narrow":[],"reject_too_broad":[],"reject_wrong":[],"note":""},"intro_type":"배경지식","sentence_relevance":[${relevanceTemplate}],"why_unrelated":"","flow_without":"","trap_sentences":{"${trapKey1}":"그건 반박당하는 통념이라 무관이 아니에요 — 전환점 뒤를 보세요.","${trapKey2}":"그 문장은 주제를 뒷받침하는 근거라 빼면 흐름이 끊겨요 — 딴 얘기를 하는 문장을 다시 찾아보세요."},"check_questions":["",""],"note":""}`;
};

// 독립 재사용 함수: 지문/정답 → 무관 채점키 rubric 객체 (claude-sonnet-5 고정)
export async function generateOmitRubric(
  passage: string,
  answer: number | null,
  opts: { gatewayKey: string },
) {
  const omitPrompt = buildOmitPrompt(passage, answer);
  // 게이트웨이가 이스케이프 안 된 큰따옴표로 깨진 JSON을 뱉으면 1회 재시도.
  let parsed: any;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    // 프로바이더 라우팅은 callChat 이 담당(LLM_PROVIDER 로 openai↔gateway 전환).
    // topic(6버킷) + sentence_relevance(5) + why_unrelated + flow_without + trap_sentences
    // + check_questions → 넉넉히 상향(삽입 브랜치에 준함).
    const { status, data, content } = await callChat(
      [
        { role: "system", content: "너는 정확한 JSON만 출력하는 채점키 생성기다." },
        { role: "user", content: omitPrompt },
      ],
      { maxTokens: 5000 },
    );
    try {
      parsed = extractJson(content);
      break;
    } catch (e) {
      // 게이트웨이가 실제로 뭘 반환했는지 표면화(레이트리밋/쿼터/에러 바디는 non-JSON).
      lastErr = new Error(
        `omit rubric parse fail (gw status ${status}): ${JSON.stringify(data).slice(0, 500)}`,
      );
    }
  }
  if (parsed === undefined) throw lastErr;

  // ── NORMALIZE ──
  // answer 는 제공된 정답을 우선(ground truth). 없으면 파싱값(1-5로 클램프).
  const parsedAnswer =
    typeof parsed.answer === "number" && parsed.answer >= 1 && parsed.answer <= 5
      ? parsed.answer
      : null;
  const forcedAnswer =
    typeof answer === "number" && answer >= 1 && answer <= 5 ? answer : parsedAnswer;

  // topic — 빈칸/삽입과 동일한 6버킷 구조체로 강제(배열은 [] 기본).
  const strArr = (v: any): string[] =>
    Array.isArray(v) ? v.filter((s: any) => typeof s === "string" && s.trim()).map((s: string) => s.trim()) : [];
  const rawTopic = parsed.topic && typeof parsed.topic === "object" ? parsed.topic : {};
  const topic = {
    canonical: typeof rawTopic.canonical === "string" ? rawTopic.canonical.trim() : "",
    accept: strArr(rawTopic.accept),
    reject_too_narrow: strArr(rawTopic.reject_too_narrow),
    reject_too_broad: strArr(rawTopic.reject_too_broad),
    reject_wrong: strArr(rawTopic.reject_wrong),
    note: typeof rawTopic.note === "string" ? rawTopic.note.trim() : "",
  };

  // intro_type ∈ {통념,주장,배경지식,통념반박,기타}, 기본 배경지식.
  const intro_type = OMIT_INTRO_TYPES.includes(parsed.intro_type)
    ? parsed.intro_type
    : "배경지식";

  // sentence_relevance — 정확히 5개(num 1..5). relevant = (num !== answer) 로 강제
  //   (모델 출력 무시 — answer 가 ground truth) → relevant:false 정확히 1개 == answer 불변식.
  //   why 는 모델 값 유지(폴백 문자열).
  const rawRel: any[] = Array.isArray(parsed.sentence_relevance) ? parsed.sentence_relevance : [];
  const relByNum = new Map<number, any>();
  for (const r of rawRel) {
    if (r && typeof r.num === "number") relByNum.set(r.num, r);
  }
  const sentence_relevance = [1, 2, 3, 4, 5].map((num) => {
    const src = relByNum.get(num) ?? {};
    const relevant = forcedAnswer != null ? num !== forcedAnswer : src.relevant !== false;
    const why =
      typeof src.why === "string" && src.why.trim()
        ? src.why.trim()
        : relevant
          ? "이 문장은 글의 주제·흐름에 기여합니다."
          : "이 문장은 글의 주제와 무관합니다.";
    return { num, relevant, why };
  });

  // trap_sentences — 키는 문자열 번호 1-5, 정답 키 제외, 빈 값 제외.
  const rawTraps =
    parsed.trap_sentences && typeof parsed.trap_sentences === "object"
      ? parsed.trap_sentences
      : {};
  const trap_sentences: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawTraps)) {
    const n = parseInt(String(k).replace(/[^0-9]/g, ""), 10);
    if (!Number.isInteger(n) || n < 1 || n > 5) continue; // 1-5 문장만
    if (forcedAnswer != null && n === forcedAnswer) continue; // 정답 문장은 함정이 아님
    if (typeof v === "string" && v.trim()) trap_sentences[String(n)] = v.trim();
  }

  // why_unrelated / flow_without — 비어있지 않은 문자열(폴백).
  const why_unrelated =
    typeof parsed.why_unrelated === "string" && parsed.why_unrelated.trim()
      ? parsed.why_unrelated.trim()
      : "그 문장은 글의 주제와 직접 관련이 없습니다.";
  const flow_without =
    typeof parsed.flow_without === "string" && parsed.flow_without.trim()
      ? parsed.flow_without.trim()
      : "그 문장을 빼면 앞 문장과 뒤 문장이 자연스럽게 이어집니다.";

  // check_questions — 트림된 비어있지 않은 문자열 배열(기본 []).
  const check_questions = Array.isArray(parsed.check_questions)
    ? parsed.check_questions
        .filter((q: any) => typeof q === "string" && q.trim())
        .map((q: string) => q.trim())
    : [];

  return {
    type: "omit" as const,
    answer: forcedAnswer,
    topic,
    intro_type,
    sentence_relevance,
    why_unrelated,
    flow_without,
    trap_sentences,
    check_questions,
    note: typeof parsed.note === "string" ? parsed.note : "",
    model: ACTUAL_MODEL,
    provider: ACTUAL_PROVIDER,
    provenance_verified: true,
  };
}

// 독립 재사용 함수: 지문/선지/정답 → 채점키 rubric 객체 (claude-sonnet-5 고정)
export async function generateRubric(
  passage: string,
  choices: string[],
  answer: number | null,
  opts: { gatewayKey: string },
) {
  const sentences = segmentSentences(passage);
  const prompt = buildPrompt(passage, sentences, choices, answer);
  let parsed: any;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    // 프로바이더 라우팅은 callChat 이 담당(LLM_PROVIDER 로 openai↔gateway 전환).
    const { content } = await callChat(
      [
        { role: "system", content: "너는 정확한 JSON만 출력하는 채점키 생성기다." },
        { role: "user", content: prompt },
      ],
      { maxTokens: 2500 },
    );
    try {
      parsed = extractJson(content);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (parsed === undefined) throw lastErr;

  // polarity 길이 정렬 보정
  const valid = new Set(["+", "-", "?"]);
  let polarity: string[] = Array.isArray(parsed.polarity) ? parsed.polarity : [];
  polarity = polarity.map((p: string) => (valid.has(p) ? p : "?"));
  if (polarity.length < sentences.length) {
    polarity = polarity.concat(Array(sentences.length - polarity.length).fill("?"));
  } else if (polarity.length > sentences.length) {
    polarity = polarity.slice(0, sentences.length);
  }

  const t = parsed.topic ?? {};
  const resolvedAnswer = typeof parsed.answer === "number" ? parsed.answer : answer;

  // recovery: 논리관계 축(HIDDEN). relation 은 4관계 중 하나로 강제,
  // choice_satisfies[answer]=true 강제(정답은 항상 관계를 만족), 나머지는 LLM 판단.
  const RELATIONS = ["재진술", "대조", "인과", "예시"];
  const rawRec = parsed.recovery && typeof parsed.recovery === "object" ? parsed.recovery : {};
  const relation = RELATIONS.includes(rawRec.relation) ? rawRec.relation : "재진술";
  const rawCS =
    rawRec.choice_satisfies && typeof rawRec.choice_satisfies === "object"
      ? rawRec.choice_satisfies
      : {};
  const choice_satisfies: Record<string, boolean> = {};
  for (let i = 1; i <= (choices ?? []).length; i++) {
    choice_satisfies[String(i)] = rawCS[String(i)] === true;
  }
  // 정답 선지는 무조건 관계를 만족(불변식 강제, ground truth).
  if (typeof resolvedAnswer === "number") choice_satisfies[String(resolvedAnswer)] = true;
  const recovery = { axis: "relation" as const, relation, choice_satisfies };

  return {
    topic: {
      canonical: t.canonical ?? "",
      accept: t.accept ?? [],
      reject_too_narrow: t.reject_too_narrow ?? [],
      reject_too_broad: t.reject_too_broad ?? [],
      reject_wrong: t.reject_wrong ?? [],
      note: t.note ?? "",
    },
    intro_type: parsed.intro_type ?? null,
    polarity,
    theme_keywords: parsed.theme_keywords ?? [],
    answer: resolvedAnswer,
    recovery,
    sentences, // 정렬 검증용
    model: ACTUAL_MODEL,
    provider: ACTUAL_PROVIDER,
    provenance_verified: true,
  };
}

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response("Unauthorized", { status: 401, headers: cors });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const reqBody = await req.json();
    // insert_sentence: 삽입 유형 전용 — 삽입할 별도 문장(선지가 아님). body로도 받을 수 있고
    // problem_id로 로드할 때 DB에서도 가져온다.
    let { problem_id, passage, choices, answer, question_type, insert_sentence, store = false } = reqBody;

    if (problem_id && (!passage || !choices || !question_type)) {
      const { data: prob } = await admin.from("problems")
        .select("passage, choices, answer, question_type, insert_sentence").eq("id", problem_id).maybeSingle();
      if (!prob) {
        return new Response(JSON.stringify({ error: "문제를 찾을 수 없습니다." }),
          { status: 404, headers: cors });
      }
      passage = passage ?? prob.passage;
      choices = choices ?? prob.choices;
      answer = answer ?? prob.answer ?? null;
      question_type = question_type ?? prob.question_type ?? null;
      insert_sentence = insert_sentence ?? prob.insert_sentence ?? null;
    }
    if (!passage || !Array.isArray(choices)) {
      return new Response(JSON.stringify({ error: "passage/choices가 필요합니다." }),
        { status: 400, headers: cors });
    }

    const gatewayKey = Deno.env.get("GATEWAY_API_KEY")!;
    const rubric = question_type === "순서"
      ? await generateOrderRubric(passage, choices, answer ?? null, { gatewayKey })
      : question_type === "어법"
        ? await generateGrammarRubric(passage, choices, answer ?? null, { gatewayKey })
        : question_type === "어휘"
          ? await generateVocabRubric(passage, choices, answer ?? null, { gatewayKey })
          : question_type === "삽입"
            ? await generateInsertRubric(passage, insert_sentence ?? "", answer ?? null, { gatewayKey })
            : question_type === "무관"
              ? await generateOmitRubric(passage, answer ?? null, { gatewayKey })
              : await generateRubric(passage, choices, answer ?? null, { gatewayKey });

    // 기본은 저장하지 않는다(사람 검증 후 승인 저장). store=true 일 때만 upsert.
    let stored = false;
    if (store && problem_id) {
      const patch: any = { grading_rubric: rubric };
      if ((answer == null) && typeof rubric.answer === "number") patch.answer = rubric.answer;
      const { error } = await admin.from("problems").update(patch).eq("id", problem_id);
      if (error) {
        return new Response(JSON.stringify({ error: `저장 실패: ${error.message}`, rubric }),
          { status: 500, headers: cors });
      }
      stored = true;
    }

    return new Response(JSON.stringify({ problem_id: problem_id ?? null, rubric, stored }),
      { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: cors });
  }
});
