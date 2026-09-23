# CommishHQ

CommishHQ is a focused fantasy-football commissioner app. The current implementation includes the Phase 1 foundation plus **Phase 2 Sleeper league import and commissioner-approved team claiming**.

The product intentionally stays narrow: league connection/identity now, secure trade voting in Phase 3, Web Push in Phase 4, and weekly recaps in Phase 5. Yahoo and ESPN remain future provider adapters.

## Local setup

Requires Node.js 22.12+ and npm. Docker Desktop is needed only for the full local Supabase stack; unit/database tests use PGlite and do not require production credentials.

```sh
npm ci
npx supabase start
npx supabase db reset
```

Copy `.env.example` to `.env.local`. Use the URL and publishable key shown by `npx supabase status`. For Phase 2 server-only import and claim operations, also configure a Supabase secret key. Prefer the modern `SUPABASE_SECRET_KEY`; `SUPABASE_SERVICE_ROLE_KEY` is accepted only as a legacy fallback.

```sh
npm run dev
```

Open http://localhost:3000.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe publishable key |
| `SUPABASE_URL` | Server-side Supabase URL; may match the public URL |
| `SUPABASE_SECRET_KEY` | Preferred server-only Supabase secret key for trusted sync/claim operations |
| `SUPABASE_SERVICE_ROLE_KEY` | Legacy fallback for local/older Supabase projects |
| `APP_URL` | Canonical application origin for auth redirects |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key; optional locally |

Never expose `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` through `NEXT_PUBLIC_*`, browser code, logs, or committed files. The normal authenticated Supabase client still verifies the user first; the admin client is isolated in `src/lib/supabase/admin.ts` and is used only by server code.

## Phase 2: Sleeper

A signed-in commissioner can open `/leagues/new`, enter a Sleeper League ID, and import:

- league identity and season
- teams and Sleeper managers
- records, points for, and points against
- current Sleeper/NFL week when the seasons match
- current-week matchups

Sleeper responses are validated with Zod before normalization. Provider-specific payloads stay inside `src/lib/fantasy/providers/sleeper/`.

The sync is idempotent by provider/external identifiers. Re-importing the same Sleeper league updates existing records instead of creating duplicate teams or matchups. A league is marked `syncing`, `complete`, or `failed` and each run is recorded in `sync_runs`.

### Team claiming

The league importer becomes the initial CommishHQ commissioner. A manager can request a team from `/leagues/<leagueId>/claim`; a pending request grants no league identity or future voting permission.

The commissioner reviews requests at `/leagues/<leagueId>/claims`. Approval runs through a server-only Postgres function and database uniqueness constraints enforce:

- at most one approved team per manager per league
- at most one approved primary manager per team
- no cross-league team assignment
- no browser-side direct membership elevation

The public application does not trust a Sleeper username as proof of ownership.

## Database

Migrations:

- `20260923195759_foundation.sql` — profiles, leagues, connections, teams, memberships, base RLS
- `20260923224500_phase2_sleeper.sql` — Sleeper sync fields, provider members, matchups, team claims, sync runs, claim review RPC, additional RLS

All exposed Phase 2 tables have RLS enabled. Normal authenticated clients are read-only for authoritative league/team membership data; privileged mutations happen server-side after the user session has been independently verified.

For a hosted project, link it with the Supabase CLI and apply committed migrations. After applying schema changes, run Supabase security/performance advisors and review every warning before public beta.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run build:vinext
```

Run the two builds sequentially because both generate Next.js route types.

Tests cover the Phase 1 auth/RLS foundation plus Sleeper validation/mapping, decimal score handling, matchup pairing, standings ordering, team-claim RLS, server-only claim review, forged reviewer rejection, and duplicate ownership prevention.

## Cloudflare Workers

The app retains the Cloudflare/vinext deployment path from Phase 1:

```sh
npm run build:vinext
npm run start:vinext
# after configuring Cloudflare auth/secrets:
npm run deploy:vinext
```

Configure the server-only Supabase secret as a Cloudflare secret/runtime secret rather than a public build variable.

Cloudflare Cron remains disabled until Phase 5. The current service worker only provides the offline shell; Web Push arrives in Phase 4.

## Current phase boundaries

Implemented:
- Phase 1 foundation/auth/RLS/PWA shell
- Phase 2 Sleeper import, standings, current matchups, team claiming

Not implemented:
- Phase 3 secure trade voting
- Phase 4 Web Push notifications
- Phase 5 Tuesday weekly recaps
- Yahoo connector
- ESPN connector

Do not treat placeholder Trades or Recaps pages as working features yet.

## Source map

- `src/app/leagues/` — import, league view, claim/review flows
- `src/lib/fantasy/providers/sleeper/` — Sleeper validation/client/adapter/mapper
- `src/lib/fantasy/sync/` — normalized persistence/sync service
- `src/lib/supabase/` — user-scoped and server-only Supabase clients
- `supabase/migrations/` — schema, constraints and RLS
- `tests/` — credential-free unit and Postgres authorization tests
