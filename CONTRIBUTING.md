# Contributing to EvalSmith

Thank you for taking the time to improve EvalSmith. This project is an early open-source release, so contributions should keep the repository easy to run, safe to publish, and clear for self-hosted users.

## Ground Rules

- Keep changes focused. One pull request should solve one problem.
- Do not commit credentials, private customer data, internal endpoints, local logs, generated exports, screenshots with secrets, or environment files.
- Prefer existing project patterns over new abstractions.
- Update documentation when behavior, setup, or user-facing workflows change.
- Include verification notes in every pull request.

## Branches

- `main` is the stable public branch.
- Feature, fix, and documentation work should use `leo/<topic>` branches.
- Release preparation branches should use `leo/release-v<version>`.

Examples:

```text
leo/fix-monitor-retry
leo/docs-open-source
leo/release-v0.1.0
```

## Commit Messages

Use concise Conventional Commits:

```text
feat: add dataset comparison view
fix: retry transient trace-service reads
docs: update Docker Compose quick start
chore: prepare open-source release
test: add evaluator smoke coverage
refactor: simplify trace query filters
```

Recommended types:

- `feat`: user-visible feature
- `fix`: bug fix
- `docs`: documentation only
- `test`: tests only
- `refactor`: behavior-preserving code change
- `chore`: maintenance, build, release, or repository hygiene
- `security`: security hardening or secret handling

## Required Checks

Run these before opening a pull request:

```sh
make open-source-check
npm run build --prefix web
python3 -m py_compile services/monitor-service/app/service.py services/monitor-service/app/settings.py scripts/run_test_env_e2e.py
```

When the change touches service logic, SDKs, or frontend workflows, also run the relevant tests. If a full local test suite cannot run because of Docker, network, or machine resource limits, say so in the pull request and include the partial checks that did run.

## Security

Never submit real secrets. Placeholder values should use `__REDACTED_SECRET__` or documented demo-only values.

Before submitting, scan for obvious secret patterns:

```sh
rg -l --hidden -S 'sk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY\s*=|api[_-]?key\s*[:=]\s*["'\'' ]?[A-Za-z0-9_-]{20,}|token\s*[:=]\s*["'\'' ]?[A-Za-z0-9._-]{20,}' . \
  -g '!web/node_modules/**' \
  -g '!web/dist/**' \
  -g '!.git/**' \
  -g '!logs/**' \
  -g '!out/**'
```

If a secret has been exposed in a branch, issue, log, screenshot, or chat, rotate it immediately. Removing it from a later commit is not enough.

## Pull Request Checklist

Every pull request should include:

- Summary of the change
- Why the change is needed
- Verification commands and results
- Screenshots or recordings for UI changes
- Migration or deployment notes, if any
- Security impact, especially for auth, API keys, env vars, logs, or exported files

## Chinese Maintainer Notes

中文仓库维护规范见：

```text
docs/maintenance/GITHUB_MAINTENANCE_CN.md
docs/maintenance/REPOSITORY_STANDARDS_CN.md
```

