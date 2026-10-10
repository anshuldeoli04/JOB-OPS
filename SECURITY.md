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

JOB-OPS is designed as a standalone local developer CLI tool:
- **Process Isolation**: Subprocesses spawned by the CLI inherit a strictly sanitized environment (`sanitizeChildEnv`). System secrets, private credentials, and unrelated environment variables are stripped before executing child processes or scraper runtimes.
- **Secrets & Credentials**: Bring Your Own Key (BYOK) architecture. API keys are stored locally in `.env`. Never commit `.env` or `config.local.json` to version control.
