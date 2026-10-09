@echo off
title JOB-OPS Setup
color 0A

echo.
echo  ============================================
echo   JOB-OPS - Autonomous AI Job Pipeline
echo   Setup Script for Windows (CLI Edition)
echo  ============================================
echo.

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found!
    echo  Please download and install Node.js LTS (>= 20.0.0) from https://nodejs.org/
    echo  Then run this setup script again.
    pause
    exit /b 1
)

echo  [OK] Node.js found:
node --version
echo.

echo  [*] Installing dependencies...
npm install
if %errorlevel% neq 0 (
    echo  [ERROR] npm install failed. Please check your internet connection.
    pause
    exit /b 1
)
echo  [OK] Dependencies installed.
echo.

echo  [*] Installing Playwright Chromium browser...
npx playwright install chromium
if %errorlevel% neq 0 (
    echo  [WARN] Chromium installation failed. You can retry with: npx playwright install chromium
) else (
    echo  [OK] Chromium installed.
)
echo.

if not exist "data" mkdir data
if not exist "reports" mkdir reports
if not exist "output" mkdir output
echo  [OK] Runtime directories ready.
echo.

if not exist "config.local.json" (
    copy /Y config.json config.local.json >nul
    echo  [OK] config.local.json created from template.
)

if not exist ".env" (
    if exist "env.example" copy /Y env.example .env >nul
    if exist ".env.example" copy /Y .env.example .env >nul
    echo  [OK] .env created from template.
)

if not exist "cv.md" (
    copy /Y cv.example.md cv.md >nul
    echo  [OK] cv.md created from template.
)

findstr /b /c:"GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE" .env >nul 2>&1
if %errorlevel% equ 0 (
    echo  [!] IMPORTANT: Gemini API key is not configured!
    echo.
    echo  Instructions:
    echo  1. Open browser: https://aistudio.google.com/apikey
    echo  2. Click "Create API key" (Free tier, no billing required)
    echo  3. Copy your key
    echo  4. Paste into .env as GEMINI_API_KEY
    echo  5. Save .env
    echo.
    echo  Opening .env in Notepad...
    timeout /t 2 >nul
    start notepad .env
    echo.
)

echo.
echo  [*] Running setup verification check...
node setup-check.mjs
echo.

echo  ============================================
echo   Setup complete!
echo.
echo   CLI COMMANDS:
echo   - node scanner.mjs          : Scan job boards for new openings
echo   - node scan-evaluate.mjs     : Batch evaluate discovered jobs
echo   - node evaluate.mjs          : Evaluate any single job posting
echo   - node resume-builder.mjs    : Generate customized resume
echo   - node autoflow.mjs          : Run end-to-end automated pipeline
echo   - node tracker.mjs           : Interactive application tracking
echo  ============================================
echo.
pause
