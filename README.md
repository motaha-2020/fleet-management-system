# منصة إدارة الأسطول — Fleet Management SaaS

Multi-tenant fleet management platform (Egypt first). The plan lives in [`docs/`](docs/):
[PRD v0.3](docs/PRD_v0.3.md) · [Backlog](docs/Backlog_Epics_Stories_v0.3.md) · [Architecture](docs/Architecture_v0.1.md) · [Egypt profile](docs/Country_Profile_Egypt.md) · [clickable prototype](docs/prototype/index.html).

**Status: M0 — Walking Skeleton** (Architecture §14): platform admin provisions a company → company admin adds a
vehicle on the web → driver activates the mobile app with a one-time code and sees the vehicle.

## Repository layout

```
apps/
  api/       NestJS API (auth, tenant routing, RBAC guard, platform, vehicles, drivers)
  worker/    pg-boss consumer (tenant provisioning; KPIs/alerts later)
  web/       Next.js dashboard (UI only, Arabic RTL + English)
  mobile/    Expo driver app
packages/
  domain/    pure TS rules: RBAC evaluation, vehicle validation, UUIDv7, activation codes
  contracts/ Zod schemas + route table = the API contract; typed client; OpenAPI generator
  db/        SQL migrations (control + tenant), migration runner, provisioner, Drizzle schema
  config/    RBAC matrix as data, D-* defaults, country templates (EG)
  i18n/      ar / en messages
infra/       docker-compose (local), Dockerfile (api / worker / web targets)
docs/        PRD, backlog, architecture, prototype
```

## Run it locally

Requirements: Node 22.12+, pnpm 10, PostgreSQL 16 (or Docker).

```bash
docker compose -f infra/docker-compose.yml up -d postgres
```

```bash
pnpm install && pnpm build
```

```bash
cp .env.example .env && node apps/api/dist/cli/gen-env.js >> .env
```
(The generator appends fresh `MASTER_KEY` and `JWT_PRIVATE_KEY_B64` values.)

```bash
pnpm db:migrate
```

```bash
pnpm db:seed -- --email admin@fleet.local --password 'choose-a-long-password'
```

Then, each in its own terminal:

```bash
pnpm --filter @fleet/api start
```

```bash
pnpm --filter @fleet/worker start
```

```bash
pnpm --filter @fleet/web dev
```

```bash
pnpm --filter @fleet/mobile start
```

Web: http://localhost:3000 — sign in as the platform admin, add a company, open the invite link it shows,
add a vehicle and a driver, issue an activation code. Mobile: Expo Go on a phone (set
`EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:4000`), or press `w` for the web build.
API contract: http://localhost:4000/openapi.json

## Tests

```bash
DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm turbo run build typecheck test
```

Integration tests create and drop their own databases; without `DATABASE_ADMIN_URL` they are skipped.

| Suite | Covers |
|---|---|
| `packages/domain` | RBAC decisions, plate normalisation (Arabic digits/spacing), US-E05-01 vehicle rules, UUIDv7, activation codes |
| `packages/db` (PostgreSQL) | provisioning is idempotent; tenant role cannot connect to another tenant's DB; no `DELETE`; append-only audit; VEH-002 unique index; failed provisioning is recorded |
| `apps/api` (PostgreSQL) | end-to-end M0 flow; tenant isolation (US-E01-02); duplicate plate names the clashing vehicle; activation code single-use; device revocation; refresh rotation + reuse detection; lockout |

## Security model in M0 (what is real, what is deferred)

Real now: database-per-tenant with a per-tenant DB role; tenant taken only from the signed token; RBAC matrix
enforced by one global guard; argon2id passwords; EdDSA access tokens (15 min) + rotating refresh tokens
(HttpOnly cookie on web, keystore on mobile); lockout after 5 failures; one-time 24h activation codes; issuing a
new code revokes the old device at once; append-only audit logs.

Deferred (must land before the pilot): TOTP MFA for admins (US-E02-01, M1) · device key-pair proof + PIN/biometric
(M3, with the Offline Grant) · invite/notification email (invite links are shown to the platform admin for now) ·
per-IP rate limiting · object-storage prefix per tenant (with Documents, M1).
