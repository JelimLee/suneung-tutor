"""FastAPI app — Step-1 port of the grade-topic Edge function.

Runs alongside production (Supabase Edge). Reaches Supabase ONLY for JWT
validation (GoTrue); it does not read or write any project table.

Local run:  uvicorn main:app --reload --port 8000   (from the api/ directory)
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()  # api/.env

from routers.grade_topic import router as grade_topic_router  # noqa: E402

app = FastAPI(title="suneung-tutor API (fastapi-port)", version="0.1.0")

# CORS mirrors the Edge fn's permissive headers so the browser client can call
# this the same way it calls functions.invoke.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["authorization", "x-client-info", "apikey", "content-type"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(grade_topic_router)
