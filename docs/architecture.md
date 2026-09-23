# Phase 1 architecture

Scope: foundation only. No league importer, team claiming endpoint, ballots, push delivery, recap generation, or scheduled jobs are implemented.

1. **Next.js App Router + strict TypeScript.** Server Components render pages. Small client components handle navigation, authentication forms, and service-worker registration. Zod validates auth input, configuration, and normalized domain data.
2. **Supabase Auth + Postgres.** Password sign-in, signup with email confirmation, PKCE callback and logout use server actions/routes. The proxy refreshes cookies; protected pages independently verify users with `getUser()`. Next.js Server Actions provide origin checking. Never use `getSession()` or editable metadata for authorization. Enable Supabase Turnstile CAPTCHA and email rate limits for public signup. No service-role key is needed in Phase 1.
3. **RLS first.** Profiles are private. League reads require membership or the authoritative commissioner foreign key. An internal, fixed-search-path security-definer function avoids recursive membership policies; only authenticated users can execute it, and it derives identity from `auth.uid()`. No client writes to leagues, connections, teams or memberships. The profile creation trigger ignores untrusted metadata. Membership uniqueness and composite foreign keys prevent duplicate or cross-league team ownership. Multi-team exceptions are intentionally not enabled yet.
4. **Provider boundary.** A league-scoped `FantasyProvider` returns validated internal models. External identifiers are strings; scores may be unknown rather than fabricated zeroes. Implement Sleeper schemas/client/mapper/adapter only in Phase 2. No provider-specific response types enter React.
5. **Cloudflare runtime.** Current Cloudflare documentation recommends vinext. Both standard Next.js and vinext builds are retained. vinext remains beta; keep both builds and a deployed authentication smoke test as release gates. Authenticated responses use private/no-store and no CDN, KV, R2 or image service bindings are enabled. Run builds sequentially because both generate `.next/types`.
6. **PWA foundation.** Manifest, local PNG icons, standalone mode, and a static offline fallback. Service worker never caches authenticated pages or API responses. Web Push handlers and opt-in are deferred to Phase 4.
7. **Testing.** Vitest runs validation tests and real Postgres SQL through PGlite, with only Supabase's auth roles/schema simulated. Tests require no credentials. Hosted Supabase Auth, email delivery, Turnstile and deployed Workers still need integration smoke testing with your configured services.

## Future phases (not implemented)

Phase 2 adds imports, provider sync, and commissioner-approved team identity. Phase 3 adds atomic ballot RPCs and separate anonymous eligibility/choice records. Phase 4 adds standards-based Web Push. Phase 5 adds deterministic recap facts, vocabulary cooldowns, and a separate Cloudflare Cron Worker with transactional idempotency. Do not enable Cron before these jobs exist. Voting security, concurrency and recap scheduling tests belong to those implementations, not speculative Phase 1 stubs.

## Security review

- No service-role key, auth token, password or push key is logged or committed.
- OAuth/provider secrets have no storage in the public connections table.
- No self-service league membership or ownership elevation route exists.
- Profile UPDATE is column-scoped with both USING and WITH CHECK policies.
- Public pages contain only onboarding/feature descriptions. `/settings` requires a server-verified session.
- No user HTML rendering, unsafe redirect targets, shared auth cache, or mock league data.
- Email confirmation and CAPTCHA must be enabled in the hosted Supabase project; local development deliberately permits CAPTCHA-free testing.
- Apply future migrations through source control, never manual production schema edits.

## Official references checked

- [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [vinext](https://github.com/cloudflare/vinext)
- [Supabase server-side authentication](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
