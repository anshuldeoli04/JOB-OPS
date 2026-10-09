#!/usr/bin/env bash
set -e

echo ""
echo " ============================================"
echo "  JOB-OPS - Autonomous AI Job Pipeline"
echo "  Setup Script for Linux & macOS"
echo " ============================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo " [ERROR] Node.js is not installed!"
    echo " Please install Node.js LTS (>= 20.0.0) from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v)
echo " [OK] Node.js found: $NODE_VERSION"
echo ""

# Install root dependencies
echo " [*] Installing root dependencies..."
npm install
echo " [OK] Root packages installed."
echo ""

# Install Playwright browser dependencies
echo " [*] Ensuring Playwright Chromium is installed..."
npx playwright install chromium
echo " [OK] Chromium installed."
echo ""

# Ensure runtime directories
mkdir -p data reports output
echo " [OK] Runtime directories ready."
echo ""

# Config files
if [ ! -f "config.local.json" ]; then
    cp config.json config.local.json
    echo " [OK] Created config.local.json from template."
fi

if [ ! -f ".env" ]; then
    if [ -f "env.example" ]; then
        cp env.example .env
    elif [ -f ".env.example" ]; then
        cp .env.example .env
    fi
    echo " [OK] Created .env from template."
fi

if [ ! -f "cv.md" ]; then
    cp cv.example.md cv.md
    echo " [OK] Initialized cv.md from cv.example.md template."
fi

# Run setup validation
echo " [*] Running setup validation check..."
node setup-check.mjs || true
echo ""

echo " ============================================"
echo "  Setup complete!"
echo ""
echo "  NEXT STEPS:"
echo "  1. Add your free Gemini API key to .env (from https://aistudio.google.com/apikey)"
echo "  2. Tailor your resume details in cv.md"
echo ""
echo "  CLI QUICKSTART:"
echo "  - node scanner.mjs          : Scan active job boards"
echo "  - node scan-evaluate.mjs     : Evaluate discovered jobs with LLM"
echo "  - node evaluate.mjs          : Evaluate any single job posting"
echo "  - node resume-builder.mjs    : Generate customized resume"
echo "  - node autoflow.mjs          : Run end-to-end automated pipeline"
echo "  - node tracker.mjs           : Review tracked applications"
echo " ============================================"
echo ""
