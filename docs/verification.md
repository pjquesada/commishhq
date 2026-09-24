# Phase 1 verification

Completed locally on September 23, 2026:

- `npm run typecheck`: passes; regenerates Next.js route types before checking strict TypeScript.
- `npm run lint`: passes without warnings.
- `npm test`: 28 tests pass across auth actions, normalized contracts, manifest, and actual SQL/RLS tests in PGlite.
- `npm run build`: passes. Session-dependent pages render dynamically; manifest is static.
- `npm run build:vinext`: passes and produces the Cloudflare Worker. The adapter emits informational route-classification and bundler timing messages.
- `npm run start:vinext`: starts successfully in the local Workers runtime, with only the static-assets binding.
- Browser checks: desktop and 390px mobile Home render; Trades client navigation works; Settings redirects signed-out visitors to login; no browser errors observed.
- Worker HTTP checks: Home, manifest, service worker, icon and offline page return 200. Home returns `no-store, private`. Browser service-worker registration succeeds.
- Dependency installation/audit reports zero known vulnerabilities.

No production credentials were used. No hosted database migration, real email/CAPTCHA signup, production session refresh, remote deployment or GitHub push was performed. These remain release gates after manual service configuration. The full local Supabase Docker stack was not started; migration syntax, triggers, constraints, grants and RLS were executed in PGlite against simulated Supabase Auth roles/schema.

The initial parallel build attempt exposed a collision in generated `.next/types`. Builds are now documented and run sequentially, and `typecheck` regenerates the required types so a previous vinext build does not leave it broken.

## Phase 2 verification

- `npm ci`: passed; zero reported dependency vulnerabilities (existing ESLint support/deprecation warning).
- `npm run typecheck`: passed.
- `npm run lint`: passed without lint warnings/errors.
- `npm test`: 84 tests passed across six files.
- `npm run build`: passed; all authenticated league routes are dynamic.

Added tests cover Sleeper schemas/HTTP failures/mapping, score hundredths, season guards, matchup grouping, deterministic standings, claim redirects, privileged sync authorization, actual SQL/RLS/constraints, concurrent duplicate approval submissions, rollback and sync idempotency. The original Phase 1 migration is unchanged. Database tests run the real migrations with simulated Supabase Auth roles in PGlite; its single backend serializes queries, so they are not a live multi-connection lock stress test.

No hosted Supabase migration, live configured signup/import/approval, remote deployment or production-secret validation was performed. Docker is not installed in this environment. Apply the new migration and provide the server-only Supabase secret before doing the real-service smoke test documented in README. No Phase 3 functionality is included.

- `npm run build:vinext`: passed; produced the Worker with all four new league routes. Adapter emits its existing informational classification/bundler messages.
- Built Worker smoke check: Home renders, import and claim routes redirect to sign-in with the destination preserved, and missing Supabase setup displays guidance rather than a crash. No browser errors observed. No private-key environment names found in emitted client JavaScript.
