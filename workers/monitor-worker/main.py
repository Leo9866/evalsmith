from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVICE_DIR = ROOT / "services" / "monitor-service"
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from app.db import close_db, init_db  # noqa: E402
from app.service import MonitorService  # noqa: E402
from app.settings import settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("monitor-worker")


async def main() -> None:
    await init_db()
    service = MonitorService()
    logger.info("Starting monitor worker with poll interval=%ss", settings.worker_poll_interval_seconds)
    try:
        while True:
            try:
                results = await service.process_all_active_rules()
                processed = sum(result.processed for result in results.values())
                alerts = sum(result.alerts for result in results.values())
                if processed or alerts:
                    logger.info("monitor scan processed=%s alerts=%s rules=%s", processed, alerts, len(results))
            except Exception:
                logger.exception("monitor scan failed")
            await asyncio.sleep(settings.worker_poll_interval_seconds)
    finally:
        await service.close()
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
