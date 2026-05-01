# Security Policy

## Reporting a Vulnerability

Please do not open a public issue for active vulnerabilities or leaked credentials.

Report security concerns through the maintainer contact channel configured for your GitHub organization. Include the affected component, reproduction steps, impact, and any relevant logs with secrets removed.

## Secret Handling

EvalSmith expects production secrets to be provided by environment variables, Docker Compose env files, Kubernetes Secrets, or an external secret manager. Do not commit real values for API keys, tokens, database passwords, object storage credentials, or private endpoints.
