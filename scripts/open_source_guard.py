#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT / "out" / "github-open-source"

PLACEHOLDER_URL = "__PUBLIC_URL__"
PLACEHOLDER_HOST = "__PUBLIC_HOST__"
PLACEHOLDER_SECRET = "__REDACTED_SECRET__"

EXCLUDED_DIR_NAMES = {
    ".git",
    ".claude",
    ".docker-tmp",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "build",
    "coverage",
    "data",
    "dist",
    "__pycache__",
    "logs",
    "node_modules",
    "out",
    "plan",
    "target",
    "test-results",
}
EXCLUDED_FILE_SUFFIXES = {
    ".pyc",
}
EXCLUDED_BASENAMES = {
    ".DS_Store",
    "package-lock.json",
    "uv.lock",
}
TMP_FILE_PREFIXES = ("tmp-",)

URL_PATTERN = re.compile(r"(?P<url>\b(?:http|https)://[^\s\"'<>`}]+)")
QUOTED_SECRET_PATTERN = re.compile(
    r"(?P<prefix>\b(?:api[_-]?key|access[_-]?key|secret(?:[_-]?key)?|token|password|authorization)\b\s*[:=]\s*)(?P<quote>[\"'])(?P<value>[^\"']*)(?P=quote)",
    re.IGNORECASE,
)
ENV_SECRET_PATTERN = re.compile(
    r"(?P<prefix>^\s*(?:export\s+)?[A-Z0-9_]*(?:API_KEY|ACCESS_KEY|SECRET|TOKEN|PASSWORD|AUTHORIZATION)[A-Z0-9_]*=)(?P<value>[^\s#]+)",
    re.MULTILINE,
)
SENSITIVE_ASSIGNMENT_PATTERN = re.compile(
    r"(?P<prefix>(?<![A-Za-z0-9_])[A-Z0-9_]*(?:API_KEY|ACCESS_KEY|SECRET(?:_KEY)?|TOKEN|PASSWORD|AUTHORIZATION)[A-Z0-9_]*\s*(?:\?=|:=|=)\s*)(?P<value>[^\s#;]+)"
)
ENV_FALLBACK_SECRET_PATTERN = re.compile(
    r"(?P<prefix>\b(?:os\.environ\.get|getEnv|envOr)\(\s*(?P<key_quote>[\"'])(?P<key>[^\"']*(?:API_KEY|ACCESS_KEY|SECRET|TOKEN|PASSWORD|AUTHORIZATION)[^\"']*)(?P=key_quote)\s*,\s*)(?P<quote>[\"'])(?P<value>[^\"']*)(?P=quote)",
    re.IGNORECASE,
)
DEFAULT_SECRET_CONST_PATTERN = re.compile(
    r"(?P<prefix>\b(?P<identifier>default[A-Za-z0-9_]*(?:Secret|Token|Password|APIKey|ApiKey|AccessKey|Authorization)[A-Za-z0-9_]*)\s*(?:=|:=)\s*)(?P<quote>[\"'])(?P<value>[^\"']*)(?P=quote)",
    re.IGNORECASE,
)
TYPED_SECRET_DEFAULT_PATTERN = re.compile(
    r"(?P<prefix>\b(?P<identifier>[A-Za-z_][A-Za-z0-9_]*(?:api_key|access_key|secret_key|token|password|authorization)[A-Za-z0-9_]*)\s*:[^=\n]+?=\s*)(?P<quote>[\"'])(?P<value>[^\"']*)(?P=quote)",
    re.IGNORECASE,
)
SHELL_DEFAULT_SECRET_PATTERN = re.compile(
    r"(?P<prefix>\$\{[A-Z0-9_]*(?:API_KEY|ACCESS_KEY|SECRET|TOKEN|PASSWORD|AUTHORIZATION)[A-Z0-9_]*:-)(?P<value>[^}]+)(?P<suffix>\})"
)
SHELL_DEFAULT_VALUE_PATTERN = re.compile(
    r"(?P<prefix>\$\{[^}:]+:-)(?P<value>[^}]*)(?P<suffix>\})"
)
YAML_SECRET_PATTERN = re.compile(
    r"(?P<prefix>^\s*[A-Z0-9_-]*(?:API_KEY|ACCESS_KEY|SECRET|TOKEN|PASSWORD|AUTHORIZATION)[A-Z0-9_-]*\s*:\s*)(?P<value>.+)$",
    re.IGNORECASE | re.MULTILINE,
)
BEARER_SECRET_PATTERN = re.compile(
    r"(?P<prefix>\bBearer\s+)(?P<value>(?!__REDACTED_SECRET__)[A-Za-z0-9._-]{8,})",
    re.IGNORECASE,
)
SK_LIKE_PATTERN = re.compile(r"\bsk-[A-Za-z0-9._-]{8,}\b")
UUID_SECRET_PATTERN = re.compile(
    r"(?i)\b(?:api[_-]?key|access[_-]?key|secret(?:[_-]?key)?|token|password)\b[^\n]{0,40}\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"
)

FORBIDDEN_HOST_SUFFIX_LABEL_PARTS = ()
FORBIDDEN_TEXT_FRAGMENTS = ()
ALLOWED_LOCAL_HOSTS = {
    "0.0.0.0",
    "127.0.0.1",
    "localhost",
}
ALLOWED_PUBLIC_NAMESPACE_HOSTS = {
    "w3.org",
    "www.w3.org",
}


@dataclass
class Violation:
    path: Path
    reason: str
    line_number: int | None = None
    line_text: str | None = None


def is_text_file(path: Path) -> bool:
    try:
        path.read_text(encoding="utf-8")
        return True
    except UnicodeDecodeError:
        return False


def normalize_rel_path(path: Path) -> str:
    return path.as_posix().lstrip("./")


def forbidden_text_patterns() -> list[str]:
    return ["".join(parts).lower() for parts in FORBIDDEN_TEXT_FRAGMENTS]


def forbidden_host_suffixes() -> set[str]:
    return {
        ".".join("".join(label_parts) for label_parts in suffix_parts).lower()
        for suffix_parts in FORBIDDEN_HOST_SUFFIX_LABEL_PARTS
    }


def is_excluded(rel_path: Path) -> bool:
    parts = rel_path.parts
    if any(part in EXCLUDED_DIR_NAMES for part in parts):
        return True

    basename = rel_path.name
    if basename in EXCLUDED_BASENAMES:
        return True
    if basename.startswith(TMP_FILE_PREFIXES):
        return True
    if rel_path.suffix in EXCLUDED_FILE_SUFFIXES:
        return True
    return False


def should_redact_secret_value(value: str) -> bool:
    normalized = value.strip().strip("\"'")
    if not normalized or normalized == PLACEHOLDER_SECRET:
        return False
    if normalized in {"0", "1", "true", "false", "TRUE", "FALSE"}:
        return False
    if normalized.startswith("$") or normalized.startswith("${"):
        return False
    if normalized.startswith("__") and normalized.endswith("__"):
        return False
    return True


def should_redact_bearer_value(value: str) -> bool:
    normalized = value.strip().strip("\"'")
    if not should_redact_secret_value(normalized):
        return False
    if normalized.lower() in {"owner", "admin", "developer", "annotator", "viewer", "demo", "sdk-key"}:
        return False
    return len(normalized) >= 20


def should_scan_sensitive_assignments(rel_path: Path) -> bool:
    name = rel_path.name
    suffix = rel_path.suffix.lower()
    return (
        name == "Makefile"
        or name.endswith(".env")
        or suffix in {".env", ".sh", ".yaml", ".yml"}
    )


def should_scan_yaml_secrets(rel_path: Path) -> bool:
    return rel_path.suffix.lower() in {".yaml", ".yml"}


def should_redact_sensitive_identifier(identifier: str, value: str) -> bool:
    normalized = identifier.lower()
    if normalized.endswith(("header", "name", "namespace", "pattern")):
        return False
    return should_redact_secret_value(value)


def is_local_or_placeholder_host(host: str) -> bool:
    normalized = host.strip().lower()
    if not normalized:
        return True
    if normalized in ALLOWED_LOCAL_HOSTS:
        return True
    if normalized in ALLOWED_PUBLIC_NAMESPACE_HOSTS:
        return True
    if normalized.endswith(".local"):
        return True
    if "." not in normalized and not _looks_like_ip(normalized):
        return True
    return False


def _looks_like_ip(value: str) -> bool:
    parts = value.split(".")
    if len(parts) != 4:
        return False
    try:
        octets = [int(part) for part in parts]
    except ValueError:
        return False
    return all(0 <= octet <= 255 for octet in octets)


def is_forbidden_host(host: str) -> bool:
    normalized = host.strip().lower()
    if not normalized:
        return False
    if is_local_or_placeholder_host(normalized):
        return False

    return any(
        normalized == suffix or normalized.endswith(f".{suffix}")
        for suffix in forbidden_host_suffixes()
    )


def sanitize_url(match: re.Match[str]) -> str:
    raw_url = match.group("url")
    try:
        host = urlsplit(raw_url).hostname or ""
    except ValueError:
        return PLACEHOLDER_URL
    if is_forbidden_host(host):
        return PLACEHOLDER_URL
    return raw_url


def sanitize_text(content: str, rel_path: Path) -> str:
    sanitized = URL_PATTERN.sub(sanitize_url, content)

    def replace_quoted_secret(match: re.Match[str]) -> str:
        value = match.group("value").strip()
        if not should_redact_secret_value(value):
            return match.group(0)
        return f"{match.group('prefix')}{match.group('quote')}{PLACEHOLDER_SECRET}{match.group('quote')}"

    def replace_env_secret(match: re.Match[str]) -> str:
        value = match.group("value").strip()
        if not should_redact_secret_value(value):
            return match.group(0)
        return f"{match.group('prefix')}{PLACEHOLDER_SECRET}"

    def replace_sensitive_assignment(match: re.Match[str]) -> str:
        value = match.group("value").strip()
        if not should_redact_secret_value(value):
            return match.group(0)
        return f"{match.group('prefix')}{PLACEHOLDER_SECRET}"

    def replace_env_fallback_secret(match: re.Match[str]) -> str:
        value = match.group("value").strip()
        if not should_redact_secret_value(value):
            return match.group(0)
        return f"{match.group('prefix')}{match.group('quote')}{PLACEHOLDER_SECRET}{match.group('quote')}"

    def replace_sensitive_string_default(match: re.Match[str]) -> str:
        identifier = match.group("identifier")
        value = match.group("value").strip()
        if not should_redact_sensitive_identifier(identifier, value):
            return match.group(0)
        return f"{match.group('prefix')}{match.group('quote')}{PLACEHOLDER_SECRET}{match.group('quote')}"

    def replace_shell_default_secret(match: re.Match[str]) -> str:
        value = match.group("value").strip()
        if not should_redact_secret_value(value):
            return match.group(0)
        return f"{match.group('prefix')}{PLACEHOLDER_SECRET}{match.group('suffix')}"

    def replace_yaml_secret(match: re.Match[str]) -> str:
        value = match.group("value").strip()
        shell_default = SHELL_DEFAULT_VALUE_PATTERN.search(value)
        if shell_default:
            default_value = shell_default.group("value").strip()
            if not should_redact_secret_value(default_value):
                return match.group(0)
            redacted_value = SHELL_DEFAULT_VALUE_PATTERN.sub(
                lambda shell_match: (
                    f"{shell_match.group('prefix')}{PLACEHOLDER_SECRET}{shell_match.group('suffix')}"
                ),
                value,
                count=1,
            )
            return f"{match.group('prefix')}{redacted_value}"
        if not should_redact_secret_value(value):
            return match.group(0)
        return f"{match.group('prefix')}{PLACEHOLDER_SECRET}"

    def replace_bearer_secret(match: re.Match[str]) -> str:
        if not should_redact_bearer_value(match.group("value")):
            return match.group(0)
        return f"{match.group('prefix')}{PLACEHOLDER_SECRET}"

    sanitized = QUOTED_SECRET_PATTERN.sub(replace_quoted_secret, sanitized)
    sanitized = ENV_SECRET_PATTERN.sub(replace_env_secret, sanitized)
    sanitized = ENV_FALLBACK_SECRET_PATTERN.sub(replace_env_fallback_secret, sanitized)
    sanitized = DEFAULT_SECRET_CONST_PATTERN.sub(replace_sensitive_string_default, sanitized)
    sanitized = TYPED_SECRET_DEFAULT_PATTERN.sub(replace_sensitive_string_default, sanitized)
    if should_scan_sensitive_assignments(rel_path):
        sanitized = SENSITIVE_ASSIGNMENT_PATTERN.sub(replace_sensitive_assignment, sanitized)
    sanitized = SHELL_DEFAULT_SECRET_PATTERN.sub(replace_shell_default_secret, sanitized)
    if should_scan_yaml_secrets(rel_path):
        sanitized = YAML_SECRET_PATTERN.sub(replace_yaml_secret, sanitized)
    sanitized = BEARER_SECRET_PATTERN.sub(replace_bearer_secret, sanitized)
    sanitized = SK_LIKE_PATTERN.sub(PLACEHOLDER_SECRET, sanitized)

    for suffix in forbidden_host_suffixes():
        sanitized = re.sub(
            rf"\b(?:[A-Za-z0-9-]+\.)*{re.escape(suffix)}\b",
            PLACEHOLDER_HOST,
            sanitized,
            flags=re.IGNORECASE,
        )

    for pattern in forbidden_text_patterns():
        sanitized = re.sub(re.escape(pattern), PLACEHOLDER_HOST, sanitized, flags=re.IGNORECASE)

    return sanitized


def copy_tree(source_root: Path, output_root: Path) -> None:
    if output_root.exists():
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True, exist_ok=True)

    for path in source_root.rglob("*"):
        rel_path = path.relative_to(source_root)
        if not rel_path.parts:
            continue
        if is_excluded(rel_path):
            continue

        target_path = output_root / rel_path
        if path.is_dir():
            target_path.mkdir(parents=True, exist_ok=True)
            continue

        target_path.parent.mkdir(parents=True, exist_ok=True)
        if is_text_file(path):
            content = path.read_text(encoding="utf-8")
            target_path.write_text(sanitize_text(content, rel_path), encoding="utf-8")
            target_path.chmod(path.stat().st_mode)
        else:
            shutil.copy2(path, target_path)


def validate_tree(target_root: Path) -> list[Violation]:
    violations: list[Violation] = []

    forbidden_suffixes = forbidden_host_suffixes()
    forbidden_text = forbidden_text_patterns()

    for path in target_root.rglob("*"):
        rel_path = path.relative_to(target_root)
        if any(part in EXCLUDED_DIR_NAMES for part in rel_path.parts):
            continue

        if is_excluded(rel_path):
            continue

        if path.is_dir():
            continue

        if not is_text_file(path):
            continue

        content = path.read_text(encoding="utf-8")
        for line_number, line in enumerate(content.splitlines(), start=1):
            for match in URL_PATTERN.finditer(line):
                host = urlsplit(match.group("url")).hostname or ""
                if is_forbidden_host(host):
                    violations.append(
                        Violation(rel_path, "forbidden URL host found", line_number, line.strip())
                    )

            lowered = line.lower()
            if any(
                suffix in lowered
                for suffix in forbidden_suffixes
            ):
                violations.append(
                    Violation(rel_path, "forbidden host suffix found", line_number, line.strip())
                )

            if any(pattern in lowered for pattern in forbidden_text):
                violations.append(
                    Violation(rel_path, "forbidden internal marker found", line_number, line.strip())
                )

            quoted_secret = QUOTED_SECRET_PATTERN.search(line)
            if quoted_secret:
                value = quoted_secret.group("value").strip()
                if should_redact_secret_value(value):
                    violations.append(
                        Violation(rel_path, "concrete secret value found", line_number, line.strip())
                    )

            env_secret = ENV_SECRET_PATTERN.search(line)
            if env_secret:
                value = env_secret.group("value").strip()
                if should_redact_secret_value(value):
                    violations.append(
                        Violation(rel_path, "concrete env secret found", line_number, line.strip())
                    )

            if should_scan_sensitive_assignments(rel_path):
                for sensitive_assignment in SENSITIVE_ASSIGNMENT_PATTERN.finditer(line):
                    value = sensitive_assignment.group("value").strip()
                    if should_redact_secret_value(value):
                        violations.append(
                            Violation(rel_path, "concrete inline secret assignment found", line_number, line.strip())
                        )
                        break

            env_fallback_secret = ENV_FALLBACK_SECRET_PATTERN.search(line)
            if env_fallback_secret:
                value = env_fallback_secret.group("value").strip()
                if should_redact_secret_value(value):
                    violations.append(
                        Violation(rel_path, "concrete env fallback secret found", line_number, line.strip())
                    )

            sensitive_string_default = (
                DEFAULT_SECRET_CONST_PATTERN.search(line)
                or TYPED_SECRET_DEFAULT_PATTERN.search(line)
            )
            if sensitive_string_default:
                identifier = sensitive_string_default.group("identifier")
                value = sensitive_string_default.group("value").strip()
                if should_redact_sensitive_identifier(identifier, value):
                    violations.append(
                        Violation(rel_path, "concrete sensitive string default found", line_number, line.strip())
                    )

            shell_default_secret = SHELL_DEFAULT_SECRET_PATTERN.search(line)
            if shell_default_secret:
                value = shell_default_secret.group("value").strip()
                if should_redact_secret_value(value):
                    violations.append(
                        Violation(rel_path, "concrete shell default secret found", line_number, line.strip())
                    )

            if should_scan_yaml_secrets(rel_path):
                yaml_secret = YAML_SECRET_PATTERN.search(line)
                if yaml_secret:
                    value = yaml_secret.group("value").strip()
                    shell_default = SHELL_DEFAULT_VALUE_PATTERN.search(value)
                    has_concrete_shell_default = (
                        shell_default is not None
                        and should_redact_secret_value(shell_default.group("value").strip())
                    )
                    if PLACEHOLDER_SECRET not in yaml_secret.group("prefix") and (
                        should_redact_secret_value(value) or has_concrete_shell_default
                    ):
                        violations.append(
                            Violation(rel_path, "concrete yaml secret found", line_number, line.strip())
                        )

            bearer_secret = BEARER_SECRET_PATTERN.search(line)
            if bearer_secret and should_redact_bearer_value(bearer_secret.group("value")):
                violations.append(
                    Violation(rel_path, "bearer token found", line_number, line.strip())
                )

            if SK_LIKE_PATTERN.search(line):
                violations.append(
                    Violation(rel_path, "sk-like secret found", line_number, line.strip())
                )

            if UUID_SECRET_PATTERN.search(line):
                violations.append(
                    Violation(rel_path, "uuid-like secret near key field found", line_number, line.strip())
                )

    return violations


def command_export(output_root: Path) -> int:
    copy_tree(ROOT, output_root)
    violations = validate_tree(output_root)
    if violations:
        print_violations(violations)
        return 1
    print(f"Public export created at {output_root}")
    return 0


def command_check(target_root: Path) -> int:
    if not target_root.exists():
        print(f"Target does not exist: {target_root}", file=sys.stderr)
        return 1
    violations = validate_tree(target_root)
    if violations:
        print_violations(violations)
        return 1
    print(f"Open source guard passed: {target_root}")
    return 0


def print_violations(violations: list[Violation]) -> None:
    print("Open source guard found violations:", file=sys.stderr)
    for violation in violations[:200]:
        location = normalize_rel_path(violation.path)
        if violation.line_number is not None:
            location = f"{location}:{violation.line_number}"
        print(f"- {location}: {violation.reason}", file=sys.stderr)
        if violation.line_text:
            print(f"  {violation.line_text}", file=sys.stderr)
    if len(violations) > 200:
        print(f"- ... and {len(violations) - 200} more violations", file=sys.stderr)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare and validate a GitHub-safe public export")
    subparsers = parser.add_subparsers(dest="command", required=True)

    export_parser = subparsers.add_parser("export", help="build a sanitized public export")
    export_parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"output directory, default: {DEFAULT_OUTPUT}",
    )

    check_parser = subparsers.add_parser("check", help="validate a tree against the public repository guard")
    check_parser.add_argument(
        "target",
        type=Path,
        nargs="?",
        default=DEFAULT_OUTPUT,
        help=f"directory to validate, default: {DEFAULT_OUTPUT}",
    )

    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "export":
        return command_export(args.output.resolve())
    if args.command == "check":
        return command_check(args.target.resolve())
    raise AssertionError(f"unsupported command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
