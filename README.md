# منصة إدارة الأسطول — Fleet Management SaaS

Multi-tenant fleet management platform (Egypt first). The plan lives in [`docs/`](docs/):
[PRD v0.3](docs/PRD_v0.3.md) · [Backlog](docs/Backlog_Epics_Stories_v0.3.md) · [Architecture](docs/Architecture_v0.1.md) · [Egypt profile](docs/Country_Profile_Egypt.md) · [clickable prototype](docs/prototype/index.html).

**Status: M2 — Core Ledgers** (Architecture §14), on top of M0 and M1.

| Milestone | What works |
|---|---|
| M0 | Platform admin provisions a company (database per tenant) → company admin adds a vehicle → driver activates the app with a one-time code and sees it |
| M2 | Assignments (one primary per vehicle, enforced by the database) · handover + custody timeline with gaps · odometer ledger (conflict/warning/corroborating, meter replacement) · fuel entries from web and the driver app (receipt photo, tank/duplicate/type/official-price checks, review queue, void) · Full-to-Full consumption per fuel type with data quality · costs with one expense identity per source and cost/km ("Unavailable", never 0) · corrections with maker ≠ checker · official fuel price table |
| M1 | Two-step login (TOTP) for admins · users with roles and branches · role switcher · branches · vendors · vehicle edit/lifecycle/transfer/disposal · driver master with encrypted national ID · documents with verification (maker ≠ checker), validity, versions, encrypted files · audit log · tenant suspend · RBAC matrix tested cell by cell |

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

The first sign-in of a platform or company admin sets up two-step verification (scan the QR code with any
authenticator app). Lost phone: a company admin can reset a colleague from **Users**; for the platform admin run
the seed again with `--reset-mfa`.

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
| `apps/api` M0 (PostgreSQL) | end-to-end M0 flow; tenant isolation (US-E01-02); duplicate plate names the clashing vehicle; activation code single-use; device revocation; refresh rotation + reuse detection; lockout; idle timeout; MFA enrol/verify |
| `apps/api` M1 (PostgreSQL) | one test per M1 story: branches, users/roles, role switch with MFA, vendors, vehicle lifecycle/transfer/disposal, national ID encryption + audited reveal, employment vs login, document precedence, uploads (type sniffing, 10 MB cap), maker ≠ checker, supersede, driver view vs download, cross-tenant, audit scoping, suspension |
| `apps/api` M2 (PostgreSQL) | one test per M2 story incl. Worked Examples E1 (10.0 L/100km), E3 (Unavailable), E5 (idempotent retry), DB-level expense identity, stale-correction guard |
| `packages/domain` M2 | golden tests for assignments/custody, odometer classification, fuel rules, Full-to-Full, cost/km, correction approvers |
| `apps/api` RBAC (PostgreSQL) | **every role × action cell** of the matrix in `packages/config` through the real API (US-E02-04) |
| `apps/api` TOTP | RFC 6238 test vectors, replay protection |

## Security model (what is real, what is deferred)

Real now: database-per-tenant with a per-tenant DB role that cannot connect elsewhere and has no `DELETE`; tenant
taken only from the signed token; RBAC matrix enforced by one global guard and tested cell by cell; argon2id
passwords; TOTP two-step verification mandatory for platform and company admins (replay-protected); EdDSA access
tokens (15 min) + rotating refresh tokens with reuse detection; 30-minute web idle timeout; lockout after 5
failures; one-time 24h activation codes that revoke the old device; per-tenant data key (envelope encryption) for
the national ID (plus blind index for uniqueness) and for document files; maker ≠ checker in the API and as a
database constraint; append-only audit logs, including every sensitive reveal and document download.

Deferred (must land before the pilot): device key-pair proof + PIN/biometric (M3, with the Offline Grant) ·
invite/notification email (invite links are shown to the inviter for now) · per-IP rate limiting · leaked-password
check (D-SEC-PWD) · MFA recovery codes · fuel budgets and alerts (FUEL-015, M5) · KPI snapshots with a "Recalculating" state (AUD-003, M5 — KPIs are computed on read today) · S3 adapter has not been run against real object storage yet (local disk is
what the tests use).
