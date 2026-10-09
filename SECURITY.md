# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 4.x     | :white_check_mark: |
| < 4.0   | :x:                |

## Reporting a Vulnerability
Please do not open a public issue for security problems.
Use GitHub's **Security > Report a vulnerability** (Private Vulnerability Reporting) on this repository.
We acknowledge reports within 72 hours and aim to publish a fix or advisory within 14 days.

## Local Security Architecture

JOB-OPS is designed primarily as a local developer automation tool:
- **Loopback Binding**: By default, the bridge server strictly listens on `127.0.0.1`. Do not expose it publicly without reverse proxy authentication and HTTPS.
- **Process Isolation**: Subprocesses spawned by the server inherit a strictly sanitized environment (`sanitizeChildEnv`). Database credentials, encryption master keys, and session secrets are never passed down to child processes or scraper runtimes.
- **Secrets & Keys**: Bring Your Own Key (BYOK) architecture. API keys are stored locally in `.env` (CLI) or encrypted in PostgreSQL (Web UI). Never commit `.env` or `config.local.json`.
