# JOB-OPS Frontend

This folder adds a dedicated frontend workspace for JOB-OPS.

## What's included

- React + Vite SPA in `src/`
- Auth screens (`/auth/login`, `/auth/signup`) with `experienceLevel` and `experienceYears`
- Dashboard, Applications, Scanner, Evaluate, Resume Builder, and Settings pages
- Express bridge server in `server/`
- PostgreSQL-backed auth, config, applications, scan sessions, resumes, and activity routes
- Lightweight local session file for current logged-in user tracking

## Run locally

1. Install frontend dependencies inside `frontend/`
2. Configure PostgreSQL env vars from `server/.env.example`
3. Start API bridge: `npm run server`
4. Start Vite app: `npm run dev`

## Notes

- The bridge expects the `jobops` PostgreSQL schema to already exist (initialize via `psql -U postgres -d jobops -f ../schema.sql`)
- Session authentication uses HMAC-SHA256 signed bearer tokens with local session fallback
- Scanner/evaluate/resume routes are DB-linked and ready for real `spawn()` execution next
