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
