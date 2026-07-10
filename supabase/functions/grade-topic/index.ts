// supabase/functions/grade-topic/index.ts
// 역할: 학생이 입력한 '소재 한 단어'를 rubric 버킷으로 분류한다.
//   - 클라이언트의 규칙 매처(lib/solve/gradeTopic.ts)가 'ambiguous'로 판단했을 때만 호출되는 LLM 폴백.
//   - 채점이 아니라 넛지: 절대 진행을 막지 않는다. 서버는 라벨과 짧은 이유만 돌려준다.
//   - LLM 호출은 LLM_PROVIDER 로 프로바이더를 전환한다(다른 함수들과 동일 패턴).
//     기본 openai: gpt-4o-mini(값싼 분류 호출), 키는 OPENAI_API_KEY.
//     gateway: 서강대 게이트웨이(OpenAI 호환) + claude-sonnet-5, 키는 GATEWAY_API_KEY.
// 배포: supabase functions deploy grade-topic
// 시크릿: supabase secrets set OPENAI_API_KEY=... (게이트웨이 원복 시 GATEWAY_API_KEY=...)

import { createClient } from "npm:@supabase/supabase-js@2";

// ── LLM 프로바이더 선택 ──────────────────────────────────────────────────────
// 게이트웨이 쿼터 소진 대응: 기본은 사용자 직속 OpenAI 계정으로 라우팅.
// LLM_PROVIDER=gateway 로 세팅하면 코드 변경 0으로 게이트웨이로 원복된다.
const LLM_PROVIDER = Deno.env.get("LLM_PROVIDER") ?? "openai";
const GATEWAY_URL = "https://factchat-cloud.mindlogic.ai/v1/gateway/chat/completions/";
const GATEWAY_MODEL = "claude-sonnet-5"; // 게이트웨이 원복용 고정 모델
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini"; // 값싼 소재 분류 호출

const GRADES = ["accept", "reject_too_narrow", "reject_too_broad", "reject_wrong", "ambiguous"];

// 관대한 파싱: 응답에서 첫 {...} 블록만 추출해 JSON.parse.
function extractJson(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("JSON을 찾지 못함");
  return JSON.parse(text.slice(start, end + 1));
}

const buildPrompt = (
  word: string,
  topic: {
    canonical?: string;
    accept?: string[];
    reject_too_narrow?: string[];
    reject_too_broad?: string[];
    reject_wrong?: string[];
    note?: string;
  },
  passage?: string,
) => {
  const list = (arr?: string[]) => (arr && arr.length ? arr.join(", ") : "(없음)");
  const firstSentence = passage
    ? passage.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)[0] ?? ""
    : "";
  return `당신은 수능 영어 '빈칸 추론' 문제에서 학생이 적은 '소재 한 단어'를 채점하는 채점자입니다.
채점이 아니라 방향을 잡아주는 넛지이므로, 관대하되 방향은 정확히 판별하세요.

# 채점 철학
- 방향이 맞으면 accept.
- 방향은 맞지만 세부로 지나치게 좁혔으면 reject_too_narrow.
- 상위어·지나치게 포괄적이면 reject_too_broad.
- 방향이 아예 틀렸으면 reject_wrong.
- 판단이 애매하면 ambiguous.

# 이 문제의 채점 기준(rubric)
- 대표 정답 소재(canonical): ${topic.canonical ?? "(없음)"}
- accept 예시: ${list(topic.accept)}
- reject_too_narrow 예시: ${list(topic.reject_too_narrow)}
- reject_too_broad 예시: ${list(topic.reject_too_broad)}
- reject_wrong 예시: ${list(topic.reject_wrong)}
- 채점 메모: ${topic.note ?? "(없음)"}
${firstSentence ? `\n# 지문 첫 문장(참고)\n${firstSentence}` : ""}

# 학생이 적은 소재
"${word}"

위 학생 단어를 accept | reject_too_narrow | reject_too_broad | reject_wrong | ambiguous 중 정확히 하나로 분류하세요.
아래 JSON 객체만 출력하세요. 설명·코드펜스 금지.
{"graded":"","reason":""}`;
};

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    // supabase-js functions.invoke가 apikey·x-client-info 헤더를 보내므로 반드시 허용.
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

    const { word, topic, passage } = await req.json();
    if (!word || !topic) {
      return new Response(JSON.stringify({ error: "word/topic이 필요합니다." }),
        { status: 400, headers: cors });
    }

    // 2. LLM 호출 — LLM_PROVIDER 로 openai↔gateway 전환(요청/응답 형식은 OpenAI 호환으로 동일).
    const useOpenai = LLM_PROVIDER !== "gateway";
    const res = await fetch(useOpenai ? OPENAI_URL : GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${
          useOpenai ? Deno.env.get("OPENAI_API_KEY") : Deno.env.get("GATEWAY_API_KEY")
        }`,
      },
      body: JSON.stringify({
        model: useOpenai ? OPENAI_MODEL : GATEWAY_MODEL,
        max_tokens: 300,
        messages: [
          { role: "system", content: "너는 정확한 JSON만 출력하는 소재 채점자다." },
          { role: "user", content: buildPrompt(word, topic, passage) },
        ],
      }),
    });
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? "";

    let graded = "ambiguous";
    let reason = "";
    try {
      const parsed = extractJson(content);
      graded = GRADES.includes(parsed.graded) ? parsed.graded : "ambiguous";
      reason = typeof parsed.reason === "string" ? parsed.reason : "";
    } catch (_e) {
      graded = "ambiguous";
    }

    return new Response(
      JSON.stringify({
        graded,
        reason,
        provider: LLM_PROVIDER === "gateway" ? "gateway" : "openai",
        model: LLM_PROVIDER === "gateway" ? GATEWAY_MODEL : OPENAI_MODEL,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    // 폴백 실패도 넛지이므로 학습을 막지 않는다: ambiguous로 응답.
    return new Response(JSON.stringify({ graded: "ambiguous", reason: "", error: String(e) }),
      { status: 200, headers: cors });
  }
});
