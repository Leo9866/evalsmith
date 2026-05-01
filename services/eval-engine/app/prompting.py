from __future__ import annotations

import json
import re
from typing import Any


_TEMPLATE_PATTERN = re.compile(r"\{\{\s*([^{}]+)\s*\}\}")


def resolve_template_value(payload: dict[str, Any], path: str) -> Any:
    current: Any = payload
    for segment in path.split("."):
        if isinstance(current, dict) and segment in current:
            current = current[segment]
            continue
        return None
    return current


def render_template(template: str, payload: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1).strip()
        value = resolve_template_value(payload, key)
        return json.dumps(value, ensure_ascii=False)

    return _TEMPLATE_PATTERN.sub(replace, template)


def render_text_template(template: str, payload: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1).strip()
        value = resolve_template_value(payload, key)
        if value is None:
            return "null"
        if isinstance(value, str):
            return value
        if isinstance(value, (int, float, bool)):
            return str(value)
        return json.dumps(value, ensure_ascii=False)

    return _TEMPLATE_PATTERN.sub(replace, template)


def collect_template_paths(*templates: str) -> list[str]:
    paths: set[str] = set()
    for template in templates:
        if not template:
            continue
        for match in _TEMPLATE_PATTERN.finditer(template):
            key = match.group(1).strip()
            if key:
                paths.add(key)
    return sorted(paths)


def build_prompt_preview(prompt_snapshot: dict[str, Any], sample: dict[str, Any]) -> dict[str, Any]:
    system_prompt = str(prompt_snapshot.get("system_prompt") or "")
    user_template = str(prompt_snapshot.get("user_prompt_template") or "")
    resolved_variables = {
        path: resolve_template_value(sample, path)
        for path in collect_template_paths(system_prompt, user_template)
    }
    warnings = [
        f"模板变量 {path} 未命中样本字段，将渲染为 null"
        for path, value in resolved_variables.items()
        if value is None
    ]
    rendered_system_prompt = render_text_template(system_prompt, sample) if system_prompt else ""
    rendered_user_prompt = render_text_template(user_template, sample) if user_template else ""
    messages = []
    if rendered_system_prompt.strip():
        messages.append({"role": "system", "content": rendered_system_prompt})
    if rendered_user_prompt.strip():
        messages.append({"role": "user", "content": rendered_user_prompt})

    return {
        "resolved_variables": resolved_variables,
        "system_prompt": rendered_system_prompt,
        "user_prompt": rendered_user_prompt,
        "messages": messages,
        "warnings": warnings,
    }


def attach_prompt_context(example: dict[str, Any], prompt_snapshot: dict[str, Any] | None) -> tuple[dict[str, Any], dict[str, Any] | None]:
    if not prompt_snapshot:
        return example, None

    preview = build_prompt_preview(prompt_snapshot, example)
    payload = dict(example)
    payload["prompt"] = {
        "prompt_id": prompt_snapshot.get("prompt_id"),
        "name": prompt_snapshot.get("prompt_name"),
        "version": prompt_snapshot.get("version"),
        "system": preview["system_prompt"],
        "user": preview["user_prompt"],
        "messages": preview["messages"],
    }
    return payload, preview
