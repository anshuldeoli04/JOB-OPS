## 📋 Overview & Rationale
<!-- Briefly describe the changes and motivation -->

## 🧪 Testing & Reproducible Evidence
<!-- Paste raw terminal output of test runs (e.g. npm test or verification commands). Do NOT summarize. -->

```bash
npm test
```

## 🔒 Security & Data Isolation Audit
- [ ] No personal secrets, credentials, or `.env` files are committed.
- [ ] No real user data (`./data/*.json`, personal CV) was mutated during tests.
- [ ] Tests execute in temporary directories using `JOB_OPS_DATA_DIR`.
- [ ] Subprocess environment variables are sanitized (`sanitizeChildEnv`).

## 🎯 Conventional Commit Summary
<!-- e.g. fix(scanner): support multi-keyword pagination and aggregated health states -->
