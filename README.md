# NOVA

NOVA is an Order-to-Audit manufacturing system for the NIT Tiruchirappalli internship assessment. This repository currently contains **Stage 0 only**: a Next.js shell, PostgreSQL connection, versioned migration, health endpoint, and validation setup. Orders, production, stock, billing, roles, and reports are not implemented yet.

## Requirements and stack

Use Node.js 24, npm, and Docker Compose. Next.js App Router keeps the web UI and server routes in one TypeScript application; PostgreSQL and Drizzle provide a transactional database and versioned SQL migrations for the later stock ledger. Vitest runs integration tests against a separate database.

## Run locally

1. Copy `.env.example` to `.env` and replace the local password in all three values. Use only letters and digits because Compose constructs the app's database URL from this password.
2. Run `npm ci`.
3. Run `docker compose up -d db`.
4. Run `npm run db:migrate` and `npm run db:migrate:test`.
5. Run `npm run dev` and open <http://localhost:3000>. The health endpoint is <http://localhost:3000/api/health> and returns HTTP 200 after the migration or 503 if the database is unavailable.

For a containerized app and database, run `docker compose up --build`. The app container applies migrations before starting. The test database is created by the PostgreSQL init script on a fresh volume.

## Validation

Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, and `npm run build`. Tests need the isolated `nova_test` database migrated with `npm run db:migrate:test`.

## Current scope

The first migration creates the `nova.system_settings` table for configuration values. No business data or demo credentials exist in Stage 0. The benchmark seed, schema for business entities, authorization, domain tests, exports, and design note are planned for later stages; no benchmark results are claimed yet.
