# Contributing to JOB-OPS

Thank you for your interest in contributing to JOB-OPS!

## Code of Conduct

Please treat all contributors with respect, courtesy, and professionalism.

## Licensing of Contributions

By submitting a pull request or patch to JOB-OPS, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE).

## How to Contribute

1. **Fork and Clone**: Fork the repository and create a feature branch (`feature/<name>` or `fix/<name>`).
2. **Local Environment**:
   - Node.js 20+ required.
   - Run `npm install` and `npx playwright install chromium`.
3. **Verify Tests**:
   - Ensure all automated tests pass before opening a PR:
     ```bash
     npm test
     npm run test:offline
     ```
   - If adding new features, include corresponding tests under `test/`.
4. **Pre-Commit Verification**:
   - Never commit sensitive files (`.env`, personal resumes, API keys, or data directories).
   - Ensure all code and comments use clear, professional English.
5. **Open a Pull Request**: Provide a concise summary of changes and attach test output evidence.
