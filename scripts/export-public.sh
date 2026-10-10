#!/usr/bin/env bash
# ==============================================================================
# JOB-OPS: Standalone CLI Distribution Exporter
# Exports public CLI files from an explicit allowlist and verifies zero-leak guards.
# ==============================================================================

set -euo pipefail

DEST_DIR="${1:-../JOB-OPS-PUBLIC-EXPORT}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== JOB-OPS Public Export Pipeline ==="
echo "Source: ${REPO_ROOT}"
echo "Target: ${DEST_DIR}"

mkdir -p "${DEST_DIR}"
rm -rf "${DEST_DIR:?}"/*

# 1. Explicit File & Directory Allowlist
ALLOWLIST_FILES=(
  "autoflow.mjs"
  "config-utils.mjs"
  "data-pipeline.mjs"
  "evaluate.mjs"
  "generate-pdf.mjs"
  "jobIdentity.mjs"
  "resume-builder.mjs"
  "scan-evaluate.mjs"
  "scanner.mjs"
  "setup-check.mjs"
  "setup-wizard.mjs"
  "tracker.mjs"
  "companies.json"
  "config.example.json"
  "config.json"
  "cv.example.md"
  "env.example"
  "package.json"
  "package-lock.json"
  "SETUP.bat"
  "setup.sh"
  "README.md"
  "LICENSE"
  "SECURITY.md"
  "CONTRIBUTING.md"
  "CODE_OF_CONDUCT.md"
  ".gitignore"
)

ALLOWLIST_DIRS=(
  "llm"
  "templates"
  "test"
  ".github"
  "scripts"
)

echo "--> Copying allowlisted files..."
for file in "${ALLOWLIST_FILES[@]}"; do
  if [ -f "${REPO_ROOT}/${file}" ]; then
    cp "${REPO_ROOT}/${file}" "${DEST_DIR}/${file}"
  fi
done

echo "--> Copying allowlisted directories..."
for dir in "${ALLOWLIST_DIRS[@]}"; do
  if [ -d "${REPO_ROOT}/${dir}" ]; then
    mkdir -p "${DEST_DIR}/${dir}"
    cp -r "${REPO_ROOT}/${dir}/"* "${DEST_DIR}/${dir}/"
  fi
done

# 2. Blocklist & Leak Guards
echo "--> Running verification audits on export..."

BLOCKED_PATTERNS=(
  "frontend"
  "reports"
  "data"
  "cv.md"
  "config.local.json"
  ".env"
)

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if [ -e "${DEST_DIR}/${pattern}" ]; then
    echo "❌ AUDIT FAILED: Blocked item '${pattern}' found in export directory!"
    exit 1
  fi
done

# Check for personal developer absolute path strings
if grep -rn "project_for_JOB" "${DEST_DIR}" --exclude="export-public.sh" > /dev/null 2>&1; then
  echo "❌ AUDIT FAILED: Absolute developer path string found in export!"
  exit 1
fi

# 3. Gitleaks scan if available
if command -v gitleaks &> /dev/null; then
  echo "--> Running Gitleaks scan on export..."
  gitleaks detect --no-git --source "${DEST_DIR}" -v
fi

echo "✅ Export successfully built and validated at: ${DEST_DIR}"
