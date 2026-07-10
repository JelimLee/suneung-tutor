// supabase/functions/tutor-chat/index.ts
// 역할: (1) 사용자 JWT 검증 (2) 질의 임베딩 (3) teacher_chunks 리트리벌(service_role)
//       (4) 6전략 시스템 프롬프트 + RAG 슬롯으로 Claude 호출 (5) 로그 저장
// 보안 원칙:
//   - ANTHROPIC_API_KEY / OPENAI_API_KEY는 Edge secrets — 클라이언트에 절대 없음
//   - 교사 전사 원문은 응답에 포함하지 않음 (retrieved_ids만 반환)
// 배포: supabase functions deploy tutor-chat
// 시크릿: supabase secrets set ANTHROPIC_API_KEY=... OPENAI_API_KEY=...

import { createClient } from "npm:@supabase/supabase-js@2";

const SYSTEM_BASE = `당신은 수능 영어 독해 튜터입니다. 학생의 질문에 답할 때 아래 6가지 설명 전략(XAI-ED)을 자율적으로 조합해 사용합니다. 한 응답에 보통 2~3개를 조합합니다.

1. Global — 지문 전체의 논리 흐름(주장→근거→반박→재주장 등)을 개괄.
2. Local — 특정 선지·문장에 대해 "왜 이것이 정답/오답인지"를 해당 부분에 한정해 설명.
3. Feature Relevance — 정답 판단에 결정적인 키워드·접속사·담화 표지를 명시적으로 짚음.
4. Example-based — 유사 유형의 패턴이나 사례를 끌어와 설명.
5. Comparison — 정답과 가장 헷갈리는 오답을 직접 비교해 차이를 부각.
6. Counterfactual — 핵심 요소가 달랐다면 정답이 어떻게 바뀌었을지 가정적으로 설명.

규칙:
- 정답을 바로 알려주지 말고 발문으로 유도. 한 번에 한 가지만 묻기.
- 응답은 300자 이내, 친근한 존댓말.
- 응답 마지막 줄에 자기 태깅: [전략: 사용한 전략명들]`;

const RAG_SLOT = (retrieved: string) => `

# 참고 — 인간 교사의 실제 설명 발췌 (유사 문제)
아래 발췌를 Example-based 전략의 재료로 활용하되, 그대로 복사하지 말고 현재 문제에 맞게 변형하세요. 현재 문제와 안 맞으면 무시해도 됩니다.

${retrieved}`;

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
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

    const { problem_id, messages, use_rag = true } = await req.json();
    const lastUser = messages.filter((m: any) => m.role === "user").at(-1)?.content ?? "";

    // 2. 리트리벌 (service_role — teacher_chunks는 클라이언트 정책 0개)
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let retrievedIds: string[] = [];
    let system = SYSTEM_BASE;

    if (use_rag && lastUser) {
      const embRes = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        },
        body: JSON.stringify({ model: "text-embedding-3-small", input: lastUser }),
      });
      const emb = (await embRes.json()).data[0].embedding;

      const { data: prob } = await admin.from("problems")
        .select("question_type").eq("id", problem_id).single();

      const { data: chunks } = await admin.rpc("match_teacher_chunks", {
        query_embedding: emb,
        match_count: 3,
        filter_type: prob?.question_type ?? null,
      });

      if (chunks?.length) {
        retrievedIds = chunks.map((c: any) => c.id);
        const blob = chunks
          .map((c: any) => `--- 발췌 ${c.id} ---\n${c.content.slice(0, 800)}`)
          .join("\n\n");
        system += RAG_SLOT(blob);
      }
    }

    // 3. Claude 호출 (키는 Edge secret)
    const anthRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system,
        messages,
      }),
    });
    const anth = await anthRes.json();
    const answer: string = anth.content?.[0]?.text ?? "";
    const tagMatch = answer.match(/\[전략:\s*([^\]]+)\]/);
    const strategyTags = tagMatch ? tagMatch[1].split(/[,\s]+/).filter(Boolean) : [];

    // 4. 로그 저장 (user_id는 검증된 JWT 기준)
    await admin.from("chat_messages").insert([
      { user_id: user.id, problem_id, role: "user", content: lastUser,
        condition: use_rag ? "rag" : "no_rag" },
      { user_id: user.id, problem_id, role: "assistant", content: answer,
        condition: use_rag ? "rag" : "no_rag",
        retrieved_ids: retrievedIds, strategy_tags: strategyTags },
    ]);

    // 5. 응답 — 교사 전사 원문은 포함하지 않는다
    return new Response(
      JSON.stringify({ answer, retrieved_ids: retrievedIds, strategy_tags: strategyTags }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: cors });
  }
});
