# Animal Bluff project guide

## Structure

- `apps/web`: Next.js and TypeScript browser frontend.
- `apps/server`: Node.js and TypeScript HTTP/WebSocket backend, Colyseus, and Prisma schema.
- `packages/shared`: TypeScript types and utilities shared between workspaces.

## Conventions

- Use TypeScript and strict compiler settings throughout.
- Keep browser code in `apps/web`, server-only code in `apps/server`, and dependency-free shared contracts in `packages/shared`.
- Use npm workspaces and workspace package names for internal imports.
- Format with Prettier and lint with the root ESLint configuration.
- Keep secrets in local environment files; commit only placeholders in `.env.example`.

## Important rules

- Do not invent or implement game rules until they are supplied and approved.
- Do not add authentication, Docker, or Redis without an explicit request.
- PostgreSQL is configured through `DATABASE_URL`; do not run migrations or access unrelated databases without a specific request.
- Never write reconnect tokens, secrets, or sensitive authentication data to logs. Keep the internal Audit Log separate from player-visible records and inaccessible to ordinary players, as specified in `DIGITAL_RULES.md`.
- Keep changes scoped to the requested feature and preserve existing user files.
