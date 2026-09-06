# suneung-tutor API — FastAPI port (Step 1: `grade-topic`)

Parallel-development port of the `grade-topic` Supabase Edge Function to FastAPI.
Runs **alongside** production — it does **not** touch `supabase/` (Edge) or write
to any project table. The only Supabase call it makes is JWT validation (GoTrue).

## What it does

`POST /grade-topic` classifies a student's one-word 소재 (topic) guess into one of
five rubric buckets. Two tiers, same as the production design:

1. **Tier 1 — rule matcher (0 tokens).** A faithful Python port of
   `src/lib/solve/gradeTopic.ts` (`matchTopicRule`). Decisive matches return
   immediately with `provider: "rule"`, `model: null`.
2. **Tier 2 — LLM fallback.** Only when tier 1 is `ambiguous`. Byte-for-byte the
   Edge fn's prompt / provider switch (`openai` ↔ `gateway`) / lenient JSON parse.
   Returns measured provenance (`provider` + the `model` actually called).

The response body is byte-compatible with the Edge fn so the frontend can later
swap the URL only:

```json
{ "graded": "accept", "reason": "...", "provider": "openai", "model": "gpt-4o-mini" }
```

`GET /health` → `{ "status": "ok" }`.

## Layout

```
api/
├─ main.py                 # FastAPI app, CORS, /health, router mount
├─ models.py               # pydantic request/response schemas (schema lock)
├─ routers/grade_topic.py  # 2-tier orchestration + auth + error contract
├─ services/
│  ├─ topic_rule.py        # tier-1 rule matcher (port of gradeTopic.ts)
│  ├─ llm.py               # tier-2 LLM fallback (port of the Edge LLM path)
│  └─ supabase_auth.py     # JWT validation via GoTrue (read-only)
├─ tests/parity_grade_topic.mjs
├─ requirements.txt
├─ .env.example            # names only
└─ .env                    # local values, git-ignored
```

## Run locally

```bash
cd api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then fill in values
uvicorn main:app --reload --port 8000
```

`.env` values:

| name                | purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `SUPABASE_URL`      | project URL — GoTrue JWT validation only             |
| `SUPABASE_ANON_KEY` | public anon key — GoTrue JWT validation only         |
| `LLM_PROVIDER`      | `openai` (default) or `gateway`                      |
| `OPENAI_API_KEY`    | tier-2 only, when `LLM_PROVIDER=openai`              |
| `GATEWAY_API_KEY`   | tier-2 only, when `LLM_PROVIDER=gateway`             |

Keys live in `api/.env` only — never in code or commits (`.env*` is git-ignored;
`.env.example` lists names only).

Smoke test:

```bash
curl -s localhost:8000/health          # {"status":"ok"}
```

## Parity test

Fires the same cases at the production Edge fn and the local FastAPI port and
diffs the grade. Both must agree on the graded **direction**
(`accept` / `reject_*` / `ambiguous`); rule-tier and validation cases must match
exactly, the LLM-tier case matches by direction only (non-determinism).

```bash
uvicorn main:app --port 8000          # in one shell
node api/tests/parity_grade_topic.mjs # in another (from repo root)
```

The rule-tier and validation cases need **no** local `OPENAI_API_KEY` — tier 1
short-circuits before any LLM call, and the Edge uses its own deployed key. Only
the `모호한 소재` (llm fallback) case needs `OPENAI_API_KEY` set in `api/.env` to
produce a non-`ambiguous` FastAPI answer.

## Safety (Step-1 rules)

- **No DB writes and no table reads.** `grade-topic` never touched project tables;
  this port keeps it that way. The only Supabase call is GoTrue JWT validation.
- **`supabase/` is untouched.** Production Edge keeps running.
- **Keys in `api/.env` only.** Nothing secret in code, commits, or `.env.example`.
