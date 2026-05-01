from __future__ import annotations

import json

from app.core.registry import init_registry, registry


def main() -> None:
    init_registry()
    builtins = [
        {"name": evaluator.name, "type": evaluator.type}
        for evaluator in registry.list_all()
    ]
    print(json.dumps({"built_in_evaluators": builtins}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
