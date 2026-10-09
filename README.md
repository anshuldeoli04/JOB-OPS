# JOB-OPS

> Autonomous, zero-operating-cost AI job pipeline for scanning, evaluating, and tailoring applications for early-career software engineering roles.

[![CI](https://github.com/your-org/job-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/job-ops/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)

---

## 📌 Architecture & Design Principles

JOB-OPS is designed around three strict operational constraints:
1. **Zero Operating Cost**: Built to run entirely on free-tier APIs and local hardware. No subscriptions, hosted proxies, or paid vector databases required.
2. **Bring Your Own Key (BYOK)**: Scans and evaluations run locally against your personal Gemini or Groq API keys. Your keys and CV data never leave your machine.
3. **Autonomous CLI Architecture**:
   - Standalone command-line workflow backed by atomic JSON disk storage (`data/`). Requires zero database configuration, zero background services, and runs entirely in your terminal.

---

## 🔍 Supported Sources & Health Monitoring

The scanner queries 7 distinct channels, each classified using a dedicated fetch-health state machine (`HEALTHY`, `DEGRADED`, `EMPTY`, `SELECTOR_BROKEN`, `BLOCKED`, `THROTTLED_TIMEOUT`, `ERROR`):

| Source | Method | Authentication | Default State |
|---|---|---|---|
| **Greenhouse** | Public Boards API (`/v1/boards/<slug>/jobs`) | None | Active (Default) |
| **Lever** | Public Postings API (`/v0/postings/<slug>`) | None | Active (Default) |
| **Ashby** | Public Posting API (`/posting-api/job-board/<slug>`) | None | Active (Default) |
| **Careers Pages** | Headless Playwright + JSON-LD Extraction | None | Active (Default) |
| **Internshala** | Stealth Browser (India freshers/interns) | None | Opt-in (`disabled_sources`) |
| **Naukri** | Stealth Browser + Next.js hydration wait | None | Opt-in (`disabled_sources`) |
| **Wellfound** | Stealth Browser (AngelList startups) | None | Opt-in (`disabled_sources`) |

> [!NOTE]
> Fast API sources run by default without browser overhead. To enable browser sources, see [Enabling Browser Sources](#enabling-browser-sources). All health states are recorded in `data/health-log.jsonl`.

---

## 🚀 Quick Start (CLI Mode - 5 Minutes)

### 1. Installation

**Windows:**
```cmd
SETUP.bat
```

**macOS / Linux:**
```bash
chmod +x setup.sh
./setup.sh
```

Or manually:
```bash
npm install
npx playwright install chromium
cp config.example.json config.json
cp env.example .env
cp cv.example.md cv.md
```

### 2. Configure Your API Key
1. Get a free Gemini key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Open `.env` and set:
   ```env
   GEMINI_API_KEY=your_actual_key_here
   ```
3. Update [`cv.md`](./cv.md) with your real technical background, skills, and projects.

### 3. Run the Pipeline
```bash
# 1. Scan configured job sources
node scanner.mjs

# 2. Evaluate discovered jobs with Gemini
node scan-evaluate.mjs --mode=auto

# 3. View tracked applications
node tracker.mjs

# 4. Or run the full automated autoflow
node autoflow.mjs
```

---

## 🛠️ Core CLI Workflows

### 1. End-to-End Pipeline (`autoflow.mjs`)
The primary driver for hands-free or interactive job hunting:
```bash
node autoflow.mjs
```
- **Step 1**: Discovers new jobs across Greenhouse, Lever, Ashby, Internshala, Naukri, and verified company career pages.
- **Step 2**: Prompts for confirmation and batch-evaluates matching candidates using Gemini 2.5 Flash.
- **Step 3**: Renders a ranked candidate matrix and automatically generates tailored resumes for top-tier matches.

### 2. Live Job Scanner (`scanner.mjs`)
Scans all 7 supported sources without modifying existing application records:
```bash
# Scan all enabled channels
node scanner.mjs

# Scan specific sources with keyword overrides
node scanner.mjs --sources=ashby,greenhouse --keywords=backend,engineer
```

#### Enabling Browser Sources (Naukri, Internshala, Wellfound)
Official public APIs (Greenhouse, Lever, Ashby) and standard careers pages are enabled by default for sub-5-second scans. Stealth browser-based sources require Playwright Chromium and are opt-in.
To enable browser sources:
1. Ensure Playwright Chromium is installed: `npx playwright install chromium`
2. In `config.local.json` (or `config.json`), remove them from `disabled_sources`:
   ```json
   {
     "disabled_sources": []
   }
   ```
3. Or invoke a targeted run directly via `--sources`:
   ```bash
   node scanner.mjs --sources=naukri,internshala
   ```

### 3. Deep Fit Evaluator (`evaluate.mjs`)
Paste any job description from LinkedIn, Indeed, or company websites to get an instant candidate fit assessment:
```bash
node evaluate.mjs
```
Generates fit score (1-10), calibrated letter grade (A+ through F), key strengths, honest skill gaps, and custom interview prep questions.

### 4. Intelligent Resume Tailoring (`resume-builder.mjs`)
Generates tailored, high-ATS-yield PDF and HTML resumes aligned directly with target job requirements:
```bash
# Interactive selection from evaluated jobs
node resume-builder.mjs

# Directly target a specific tracked application
node resume-builder.mjs --job-id=<application_id>
```

### 5. Application Tracker (`tracker.mjs`)
An interactive terminal dashboard for reviewing evaluated jobs and tracking your application lifecycle:
```bash
node tracker.mjs
```

---

## 🛡️ Security & Privacy Architecture

- **Subprocess Environment Sanitization**: Subprocesses launched by the CLI runner inherit a strictly allow-listed environment (`sanitizeChildEnv`). System secrets, database passwords, and master keys are systematically scrubbed before executing child scripts.
- **Zero Cloud Storage / 100% Local**: All scan results, application histories, tailored resumes, and evaluation reports are stored locally on your machine in atomic JSON and Markdown files under `data/`, `output/`, and `reports/`.
- **Bring Your Own Key (BYOK)**: All LLM evaluations and resume tailoring run directly against your personal Gemini or Groq API keys with zero telemetry or middleman servers.

---

## ⚖️ Disclaimers & Legal Notice

- **Third-Party Platform Terms**: Users are solely responsible for complying with each job platform's terms of service, robots.txt directives, and applicable local laws. The maintainers do not endorse or encourage circumventing technical access controls or terms of service. This software is provided strictly for personal, non-commercial developer job-seeking automation.
- **LLM Data Privacy**: Candidate resumes and job descriptions are sent to Google Gemini and Groq APIs for scoring and text tailoring. Please review [Google AI Studio Terms of Service](https://ai.google.dev/terms) and [Groq Terms](https://groq.com) regarding data logging on free-tier plans.
- **Single Key BYOK & Free-Tier Quotas**: The system uses a Bring-Your-Own-Key model. Pacing and circuit breakers prevent API hammering, but daily free-tier quotas are governed strictly by the upstream providers.

---

## 📄 License & Community

- **License**: [MIT](./LICENSE)
- **Security Policy**: [SECURITY.md](./SECURITY.md)
- **Contributing Guidelines**: [CONTRIBUTING.md](./CONTRIBUTING.md)
- **Code of Conduct**: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
