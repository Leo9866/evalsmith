from __future__ import annotations

import asyncio
import logging
import os
import socket
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EVAL_ENGINE_ROOT = ROOT / "services" / "eval-engine"
if str(EVAL_ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ENGINE_ROOT))

from app.core.registry import init_registry
from app.db.connection import close_db, init_db
from app.db import experiment_repo
from app.workflow.runner import ExperimentCanceled, ExperimentRunner


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s - %(message)s",
)
logger = logging.getLogger("eval-worker")


async def run_once(worker_id: str) -> bool:
    job = await experiment_repo.claim_next_job(worker_id)
    if not job:
        return False

    if job["status"] == "canceled":
        logger.info("Skipping canceled job %s", job["id"])
        return True

    payload = job["payload"] or {}
    runner = ExperimentRunner(
        experiment_id=job["experiment_id"],
        job_id=job["id"],
        project_id=job["project_id"],
        dataset_id=payload["dataset_id"],
        dataset_version=payload.get("dataset_version"),
        split=payload.get("split", "default"),
        evaluator_ids=payload.get("evaluator_ids", []),
        target_url=payload["target_url"],
        target_method=payload.get("target_method", "POST"),
        target_headers=payload.get("target_headers") or {},
        target_body_template=payload.get("target_body_template", '{"input": {{inputs.input}}}'),
        target_response_path=payload.get("target_response_path"),
        target_timeout_ms=int(payload.get("target_timeout_ms", 120000)),
        concurrency=int(payload.get("concurrency", 5)),
        prompt_snapshot=payload.get("prompt_snapshot"),
    )

    try:
        await runner.run()
        await experiment_repo.complete_job(job["id"])
        logger.info("Completed job %s for experiment %s", job["id"], job["experiment_id"])
    except ExperimentCanceled:
        await experiment_repo.cancel_job(job["id"])
        logger.info("Canceled job %s for experiment %s", job["id"], job["experiment_id"])
    except Exception as exc:
        await experiment_repo.fail_job(job["id"], str(exc), retry=True)
        logger.exception("Job %s failed", job["id"])
    return True


async def main() -> None:
    worker_id = os.environ.get("EVAL_WORKER_ID", f"eval-worker@{socket.gethostname()}")
    poll_interval = float(os.environ.get("EVAL_WORKER_POLL_INTERVAL", "1.5"))

    logger.info("Starting eval-worker %s", worker_id)
    init_registry()
    await init_db()
    try:
        while True:
            has_work = await run_once(worker_id)
            if not has_work:
                await asyncio.sleep(poll_interval)
    finally:
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
