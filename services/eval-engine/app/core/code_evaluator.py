"""Code evaluator: execute user-provided Python functions in a subprocess sandbox."""
from __future__ import annotations

import json
import logging
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path
from typing import Any

from app.core.base import BaseEvaluator
from app.models.schemas import EvalInput, EvalResult

logger = logging.getLogger(__name__)

FORBIDDEN_IMPORTS = {
    "os", "subprocess", "sys", "shutil", "socket", "http", "urllib",
    "requests", "ctypes", "multiprocessing", "signal", "importlib",
    "pickle", "shelve", "glob", "pathlib",
}

RUNNER_TEMPLATE = textwrap.dedent("""\
    import json, sys

    {user_code}

    _payload = json.loads(sys.argv[1])
    _result = evaluate(
        input=_payload.get("input"),
        output=_payload.get("output"),
        expected=_payload.get("expected"),
        metadata=_payload.get("metadata"),
        trace=_payload.get("trace"),
    )
    if not isinstance(_result, dict):
        _result = {{"score": 0.0, "reasoning": "evaluate() must return a dict"}}
    _result.setdefault("score", 0.0)
    _result["score"] = max(0.0, min(1.0, float(_result["score"])))
    print(json.dumps(_result))
""")


class CodeEvaluator(BaseEvaluator):
    """Execute user-provided Python code as an evaluator.

    Phase 2 simplified sandbox: runs in a subprocess with timeout.
    Phase 3 will upgrade to Docker + gVisor for full isolation.
    """

    def __init__(
        self,
        name: str = "code_evaluator",
        code: str = "",
        timeout_seconds: int = 30,
    ) -> None:
        super().__init__(name=name, type="code")
        self.code = code
        self.timeout_seconds = timeout_seconds

    async def evaluate(self, eval_input: EvalInput) -> EvalResult:
        if not self.code.strip():
            return EvalResult(score=0.0, reasoning="No code provided.")

        violation = _check_forbidden_imports(self.code)
        if violation:
            return EvalResult(
                score=0.0,
                reasoning=f"Forbidden import detected: {violation}",
                metadata={"error": "forbidden_import", "module": violation},
            )

        payload = json.dumps({
            "input": eval_input.input,
            "output": eval_input.output,
            "expected": eval_input.expected,
            "metadata": eval_input.metadata,
            "trace": eval_input.trace,
        }, default=str)

        runner_code = RUNNER_TEMPLATE.format(user_code=self.code)

        try:
            with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
                f.write(runner_code)
                script_path = f.name

            proc = subprocess.run(
                [sys.executable, script_path, payload],
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
                cwd=tempfile.gettempdir(),
            )

            Path(script_path).unlink(missing_ok=True)

            if proc.returncode != 0:
                stderr = proc.stderr.strip()[-500:]
                return EvalResult(
                    score=0.0,
                    reasoning=f"Code execution failed: {stderr}",
                    metadata={"error": "execution_error", "stderr": stderr},
                )

            result = json.loads(proc.stdout.strip())
            return EvalResult(
                score=float(result.get("score", 0.0)),
                reasoning=str(result.get("reasoning", "")),
                metadata=result.get("metadata", {}),
            )

        except subprocess.TimeoutExpired:
            return EvalResult(
                score=0.0,
                reasoning=f"Code execution timed out after {self.timeout_seconds}s",
                metadata={"error": "timeout"},
            )
        except json.JSONDecodeError as e:
            return EvalResult(
                score=0.0,
                reasoning=f"Code returned invalid JSON: {e}",
                metadata={"error": "json_parse_error"},
            )
        except Exception as e:
            logger.error("Code evaluator error: %s", e)
            return EvalResult(
                score=0.0,
                reasoning=f"Code evaluator error: {e}",
                metadata={"error": str(type(e).__name__)},
            )


def _check_forbidden_imports(code: str) -> str | None:
    """Basic static check for dangerous imports."""
    for line in code.split("\n"):
        stripped = line.strip()
        if stripped.startswith("import ") or stripped.startswith("from "):
            for module in FORBIDDEN_IMPORTS:
                if f"import {module}" in stripped or f"from {module}" in stripped:
                    return module
    return None
