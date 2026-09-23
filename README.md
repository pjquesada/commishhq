# CommishHQ

A focused fantasy football commissioner app. **Phase 1 only**: authentication, a responsive four-area shell, database/RLS foundation, normalized provider contracts, PWA foundation and Cloudflare deployment configuration. No fake league data or working later-phase controls.

## Local setup

Requires Node.js 22.12+ and npm. Docker Desktop is needed only for the full local Supabase stack; unit/database tests do not require Docker or credentials.

```sh
npm ci
npx supabase start
npx supabase db reset
```

Copy `.env.example` to `.env.local`. Use the URL and publishable (or local legacy anon) key shown by `npx supabase status`. Do not use the service-role key. Set `APP_URL=http://localhost:3000`.

```sh
npm run dev
```

Open http://localhost:3000. Without environment configuration the onboarding shell still works and account access displays a setup message; it does not pretend to be authenticated. Local Supabase mail is available in its printed Mailpit URL. Email confirmation is enabled locally; follow the signup link in Mailpit before signing in.

## Environment variables

| Variable                               | Purpose                                                               |
| -------------------------------------- | --------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL                                                  |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public project key; never a service-role/secret key                   |
| `APP_URL`                              | Exact canonical app origin for confirmation redirects                 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`       | Turnstile public site key; optional locally, required for public beta |

Public variables must be supplied at build time. `APP_URL` must also be supplied to the deployed Worker as a runtime variable. The Turnstile **secret is configured in Supabase Auth CAPTCHA settings**, not exposed to this app. Supabase verifies CAPTCHA tokens for sign-in/signup. Ballot-level Turnstile verification belongs to Phase 3.

## Database

`supabase/migrations/20260923195759_foundation.sql` creates profiles, leagues, league_connections, teams and league_members, plus indexes, foreign keys, constrained team ownership, timestamps, profile trigger and RLS. The migration is exercised unchanged by `tests/database.test.ts` using PGlite. Only Supabase's Auth schema is simulated. League mutations and claiming are deliberately unavailable until Phase 2.

For a hosted project, inspect `npx supabase link --help` and `npx supabase db push --help`, link your project and apply the committed migration. Do not commit database passwords. After applying, run Supabase's database/security advisors and confirm RLS in the dashboard. No hosted project was created or modified by this implementation.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run build:vinext
```

Run builds **sequentially**: Next.js and vinext both generate `.next/types`. GitHub Actions runs these checks without production credentials. Database tests cover league isolation, fabricated cross-league team IDs, denied privilege escalation, profile ownership, and membership uniqueness. Voting, provider mapping and recap tests are deferred with their corresponding phases.

On Windows, stop `start:vinext` before rebuilding: the running Worker can lock files in `dist`. Restart it after the build completes. See [verification results](docs/verification.md).

## Cloudflare Workers

Uses [Cloudflare's currently recommended vinext integration](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/), with `nodejs_compat`. vinext is beta; see [architecture decisions](docs/architecture.md). No Vercel runtime is required. There are no KV, R2, Images, Durable Object or paid service bindings.

```sh
npm run build:vinext
npm run start:vinext
# After configuring Cloudflare authentication and environment:
npm run deploy:vinext
```

The local Worker normally serves port 8787. For development parity use `npm run dev:vinext` on port 3001 and change `APP_URL` accordingly. Set runtime `APP_URL` in Worker variables and supply the public env values during build. Test the built Worker locally before deploying. Do not add blanket Cloudflare cache rules for app/auth pages.

Before a public beta:

1. Create a Supabase Free project; apply the migration and run advisors.
2. Set Supabase Auth Site URL to your HTTPS app origin and allow the exact `/auth/callback` URL. Keep email confirmation enabled, password minimum 12, anonymous sign-in disabled, and rate limits enabled.
3. Configure free Turnstile for your domains and set its secret in Supabase Auth CAPTCHA settings. Set the public site key for the app build.
4. Configure email delivery. Supabase's default email sender is restricted and is not suitable for arbitrary public signups; use an SMTP provider with a suitable free tier or restrict beta to permitted testers. Do not purchase email infrastructure implicitly.
5. Create/link your GitHub repository, commit the files and lockfile, and enable the included CI workflow. No remote URL was supplied, so no remote repository is assumed.
6. Deploy to a Cloudflare Workers Free account and test signup → email confirmation → sign-in → settings → sign-out on the deployed HTTPS origin, plus Turnstile failure, session expiry and mobile installation.

Cloudflare Cron is intentionally not activated until Phase 5. A manifest and offline-only service worker are included now; Web Push subscriptions and delivery arrive in Phase 4. The service worker stores only the static offline page, never league/account data.

## Free-tier boundaries

Keep accounts on Free plans and monitor their dashboards; free quotas can change. Workers Free request/CPU/bundle limits can constrain server rendering, and free Supabase database/storage/egress/MAU quotas plus idle pausing can affect beta availability. No claim is made that all traffic volumes fit free tiers. Review [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Supabase pricing](https://supabase.com/pricing), and [Auth email limits](https://supabase.com/docs/guides/auth/auth-smtp) before opening beta. Avoid enabling paid bindings or automatic plan upgrades. CI minutes are subject to the GitHub account's allowance.

## Source map

- `src/app/`: pages, auth actions/callback, manifest, styles
- `src/components/`: navigation, auth form, PWA registration, empty states
- `src/lib/auth/`, `src/lib/supabase/`: validated session/auth boundary
- `src/lib/fantasy/`: provider interface and Zod-normalized models
- `supabase/`: local stack configuration and migration
- `tests/`: credential-free unit and Postgres authorization tests
- `public/`: app icons, offline fallback and service worker
- `docs/architecture.md`: design, security review, phase boundaries
- `vite.config.ts`, `wrangler.jsonc`: Cloudflare build/runtime
- `.github/workflows/ci.yml`: repeatable quality gates

Stop here until Phase 2 is explicitly authorized.
