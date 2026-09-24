# CommishHQ — Phase 2

Fantasy football commissioner workspace. Phase 2 adds Sleeper import, standings, current-week matchups and commissioner-approved team identity to the existing Next.js, Supabase, PWA and Cloudflare foundation.

**Not implemented:** Phase 3 secure trade voting, Phase 4 Web Push, Phase 5 Tuesday weekly recaps, Yahoo integration, ESPN integration. No ballots, SMS, scheduled jobs or AI generation.

## Local setup

Node.js 22.12+ and npm are required. Docker Desktop is needed only for the full local Supabase stack; tests need no Docker, live Sleeper or production credentials.

```sh
npm ci
npx supabase start
npx supabase db reset
```

`db reset` is only for a disposable local database. Copy `.env.example` to `.env.local` and supply values from `npx supabase status`. Start with `npm run dev` and open http://localhost:3000. Email confirmation is enabled; use the local Mailpit URL printed by Supabase. Missing public configuration produces login setup guidance. A missing private key produces import setup guidance.

## Environment variables

| Variable                             | Purpose                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| NEXT_PUBLIC_SUPABASE_URL             | Supabase project URL                                                         |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Public key (legacy local anon key also supported)                            |
| APP_URL                              | Exact app origin, e.g. http://localhost:3000                                 |
| NEXT_PUBLIC_TURNSTILE_SITE_KEY       | Optional locally; enable for public beta Auth protection                     |
| SUPABASE_SECRET_KEY                  | **Server-only** privileged key, preferred                                    |
| SUPABASE_SERVICE_ROLE_KEY            | **Server-only** local/legacy fallback; leave empty when using the secret key |

Never put a privileged key in NEXT_PUBLIC variables, browser components, logs, or Git. Both secret example values are empty. The separate admin client has no cookies/session persistence and is used only after authentication and required ownership checks. Claims use the authenticated user client and guarded RPCs, not the admin client. Configure the Turnstile secret in Supabase Auth CAPTCHA settings.

## Database setup

Apply the committed migrations in order:

1. `20260923195759_foundation.sql`: unchanged Phase 1 foundation.
2. `20260923235640_sleeper_import_claims.sql`: sync and standings columns; provider managers and team references; matchups; team claims; sync runs; indexes, RLS, and transactional RPCs.

For hosted Supabase, inspect `npx supabase link --help` and `npx supabase db push --help`, link the intended project and apply pending migrations. Never reset a hosted database. Keep the `private` schema out of Data API exposed schemas. Run Supabase security advisors after applying. No hosted database was modified during development.

Set Auth Site URL to the app origin and allow `/auth/callback` plus its `?next=...` variants so claim links survive email confirmation. See [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls). Keep confirmation enabled, anonymous sign-in disabled, password minimum 12 and rate limits enabled. Configure SMTP for public signup or restrict beta to the default sender's allowed testers. Local Mailpit is free.

## Sleeper import and claiming

1. Sign in, select **Connect Sleeper**, and paste the league ID from its Sleeper URL.
2. The first importer becomes the **CommishHQ commissioner**. This does not prove ownership on Sleeper. Other accounts cannot take over an existing import.
3. The dashboard shows season, provider, current week, sync status, standings, Sleeper managers and matchups. **Refresh league** updates the existing snapshot. Failed refreshes retain and label old data. Retry an interrupted sync after two minutes.
4. Share the team-claim link with managers. Each manager signs in/creates an account and requests a team. Pending claims grant no membership or league access. Managers can cancel pending requests to choose another team.
5. In **Review team claims**, verify the requester's account email with the person you know, then approve/reject. Approval atomically installs authoritative membership. A Sleeper display name alone proves nothing.

One primary team per user/league and one primary manager per team are enforced in Postgres. Browser clients cannot directly assign membership, approve claims, change league ownership or mutate sync state. Requesters see their own claims, commissioners see league claims, and outsiders see neither. The claim URL exposes only a minimal signed-in league/team selection projection. It never grants approval authority.

Scoring uses `whole + hundredths / 100`. Unknown matchup scores display “—”; opponents group by matchup ID. Current week requires matching NFL season and season type. Standings sort by winning percentage (ties = half win), points for and stable roster ID, not all custom Sleeper playoff tiebreakers. “Live” means a nonfinal scoring period, not a real-time game feed. Provider owners remain separate from approved CommishHQ accounts. Sync never reassigns those accounts; inactive teams remain stored but cannot receive new approvals.

## Verification

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run build:vinext
```

Run sequentially: Next.js and vinext both write `.next/types`. Typecheck regenerates its route types. On Windows stop `start:vinext` before rebuilding to avoid locked files. CI uses the same checks. Tests exercise actual SQL in PGlite with simulated Supabase Auth roles and deterministic provider fixtures. See [verification](docs/verification.md) and [architecture/security](docs/architecture.md).

## Cloudflare

The existing vinext deployment path uses `nodejs_compat`, no Vercel runtime and no paid storage/image bindings. vinext remains beta; verify both builds and deployed authentication before release.

```sh
npm run build:vinext
npm run start:vinext
```

Worker preview normally serves http://127.0.0.1:8787; source development via `npm run dev:vinext` serves port 3001. Supply public variables at build time. For Wrangler preview put runtime values in ignored `.dev.vars`. APP_URL and Supabase redirects must match the origin actually used.

For deployment, supply SUPABASE_SECRET_KEY using Cloudflare Workers **Secrets** or `npx wrangler secret put SUPABASE_SECRET_KEY`; use the fallback instead only when necessary. Never store the key in wrangler.jsonc or public build variables. Set runtime APP_URL, supply public build variables, and use `npm run deploy:vinext`. No deployment is automatic.

After configuring services, test a real import and repeated refresh, emailed claim link, rejection/retry/approval, manager dashboard access, rejected unauthorized requests and simultaneous competing approvals against hosted Postgres. This live service smoke test remains a release gate.

## Free-tier operations

No paid dependency was added. Sync is manual with bounded/deduplicated requests. Database safeguards limit refresh attempts to one per league/30 seconds and new imports to 20 per account/hour. Monitor [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Supabase quotas](https://supabase.com/pricing) and [email limits](https://supabase.com/docs/guides/auth/auth-smtp). Do not enable automatic paid upgrades or shared caching of authenticated data. [Sleeper's API documentation](https://docs.sleeper.com/) asks commercial users to discuss licensing; confirm permitted usage before commercial launch.

## Source map

- `src/lib/fantasy/providers/sleeper/`: schemas, client, mapper, adapter
- `src/lib/fantasy/standings.ts`: deterministic ranking
- `src/lib/leagues/`: normalized models, authorized queries, sync orchestration, safe logs
- `src/lib/supabase/admin.ts`: isolated privileged client
- `src/app/leagues/`: import, dashboard, request and review pages/actions
- `src/components/league-*`, `claim-link.tsx`: responsive UI
- `supabase/migrations/`: immutable Phase 1 and new Phase 2 migrations
- `tests/`: provider, standings, auth, sync and database security tests
- `.github/workflows/ci.yml`: checks on push and PR

Repository: [pjquesada/commishhq](https://github.com/pjquesada/commishhq). Phase 2 is proposed from `phase-2-sleeper-import` through a draft PR, not merged automatically.
