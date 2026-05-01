from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[2]
SDK_PATH = ROOT / "sdks" / "python"
if str(SDK_PATH) not in sys.path:
    sys.path.insert(0, str(SDK_PATH))

import evalsmith  # noqa: E402


TRACE_URL = (
    os.environ.get("EVALSMITH_TRACE_URL")
    or os.environ.get("EVALSMITH_BASE_URL")
    or "http://127.0.0.1:8001"
)
PROJECT_ID = os.environ.get("EVALSMITH_PROJECT", "proj_default")
os.environ.setdefault("EVALSMITH_FLUSH_INTERVAL", "0.1")
os.environ.setdefault("EVALSMITH_BATCH_SIZE", "1")

evalsmith.init(project=PROJECT_ID, base_url=TRACE_URL)

app = FastAPI(title="EvalSmith Demo Agent", version="0.1.0")


class AgentRequest(BaseModel):
    input: str | dict[str, Any]


class AgentResponse(BaseModel):
    output: str
    trace_id: str
    intent: str
    confidence: float


KNOWLEDGE_BASE = {
    "billing": (
        "Billing changes take effect at the next invoice. "
        "For urgent adjustments, create a support ticket with the workspace ID."
    ),
    "latency": (
        "High latency is usually caused by oversized prompts, slow retrieval, or a cold downstream model. "
        "Start by checking trace duration, retrieval fan-out, and model queue time."
    ),
    "deployment": (
        "For production rollout, pin the prompt version, run a regression experiment, "
        "and compare exact-match plus not-empty scores before promoting traffic."
    ),
    "safety": (
        "When a response might reveal secrets or unsafe guidance, block the final answer, "
        "log the trace, and hand the case to a human reviewer."
    ),
    "general": (
        "Collect traces first, build a focused dataset from failures, and run an experiment "
        "before changing prompts or tools."
    ),
}


def route_query(query: str) -> tuple[str, float]:
    normalized = query.lower()
    if any(keyword in normalized for keyword in ("bill", "invoice", "price", "plan")):
        return "billing", 0.93
    if any(keyword in normalized for keyword in ("slow", "latency", "timeout", "performance")):
        return "latency", 0.96
    if any(keyword in normalized for keyword in ("deploy", "release", "rollout", "production")):
        return "deployment", 0.91
    if any(keyword in normalized for keyword in ("safe", "security", "secret", "prompt injection")):
        return "safety", 0.89
    return "general", 0.72


def synthesize_answer(query: str, intent: str, confidence: float) -> str:
    guidance = KNOWLEDGE_BASE[intent]
    if intent == "billing":
        return (
            "Recommended action: keep the current billing cycle stable and apply the plan change on the next invoice. "
            f"{guidance}"
        )
    if intent == "latency":
        return (
            "Recommended action: inspect the slowest trace first, then reduce prompt size and retrieval breadth. "
            f"{guidance}"
        )
    if intent == "deployment":
        return (
            "Recommended action: gate the rollout behind a regression run and only promote the candidate if quality is stable. "
            f"{guidance}"
        )
    if intent == "safety":
        return (
            "Recommended action: stop the unsafe response path and escalate it for review before serving users. "
            f"{guidance}"
        )
    return (
        f"Recommended action: clarify the request, inspect recent traces, and define success criteria for '{query}'. "
        f"{guidance}"
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "demo-agent"}


@app.post("/answer", response_model=AgentResponse)
def answer(request: AgentRequest) -> AgentResponse:
    user_input = request.input if isinstance(request.input, str) else request.input.get("question") or request.input.get("query") or str(request.input)

    with evalsmith.Trace(
        name="demo_support_agent",
        tags=["demo", "phase1"],
        metadata={"source": "demo-agent", "project_id": PROJECT_ID},
    ) as trace:
        with trace.span("intent_router", span_type="chain") as router_span:
            router_span.set_input({"query": user_input})
            intent, confidence = route_query(user_input)
            router_span.set_output({"intent": intent, "confidence": confidence})
            router_span.set_model("demo-router", token_input=max(len(user_input.split()), 1), token_output=8)

        with trace.span("knowledge_lookup", span_type="retrieval") as retrieval_span:
            retrieval_span.set_input({"intent": intent})
            context = KNOWLEDGE_BASE[intent]
            retrieval_span.set_output({"context": context})
            retrieval_span.set_metadata(intent=intent, source="local-kb")

        with trace.span("response_synthesizer", span_type="agent") as agent_span:
            answer_text = synthesize_answer(user_input, intent, confidence)
            agent_span.set_input({"query": user_input, "context": context})
            agent_span.set_output({"answer": answer_text})
            agent_span.set_model("demo-synthesizer", token_input=max(len(context.split()), 1), token_output=max(len(answer_text.split()), 1))

        return AgentResponse(
            output=answer_text,
            trace_id=trace.trace_id,
            intent=intent,
            confidence=confidence,
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8010")), reload=False)
