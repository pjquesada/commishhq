# Architecture — Phase 2

## Scope and layering

Preserves Next.js App Router, strict TypeScript, Tailwind, Supabase Auth/Postgres/RLS, PWA and Cloudflare/vinext. Adds Sleeper integration and approved manager identity only. Phase 3 voting, Phase 4 Web Push, Phase 5 Tuesday recaps, Yahoo and ESPN remain unimplemented.

Sleeper raw schemas, fixed-origin HTTP client, mapper and request-scoped FantasyProvider adapter are isolated in `src/lib/fantasy/providers/sleeper`. React sees only normalized domain/database models. Zod validates every external response before mapping. League/user snowflakes remain strings. Requests have eight-second timeouts, no shared cache, no redirects and no retry storms. Failures have safe messages, never fake-data fallback. Request-local promises deduplicate league, users and state calls. Only league, users, rosters, NFL state and weekly matchups are fetched.

Scoring uses whole + hundredths/100, including points against. Missing matchup scores remain null; explicit custom points override points even when zero. Rows group by matchup_id, not array order; null IDs are separate unpaired teams. Duplicate/unknown teams and groups over two are rejected. Active week requires matching season and season type to avoid postseason numbering contaminating a regular-season league. Completed scoring legs or completed league indicate final; future/unknown scoring periods scheduled; others live. This is a period status, not an NFL game clock.

Standings sort a copy by `(wins + ties / 2) / games`, then points for, then stable roster ID. No games means zero percentage. Numeric roster IDs use BigInt for lossless deterministic comparisons. Custom playoff tiebreakers may differ.

## Trusted persistence and sync

Cookie-aware `getUser()` authenticates users. Refresh additionally verifies persisted commissioner ownership with RLS-scoped reads before privileged persistence. The separate server-only admin client uses SUPABASE_SECRET_KEY, falling back to legacy SUPABASE_SERVICE_ROLE_KEY, with no cookies/session persistence. Secrets never enter browser code, public variables or logs.

Service-only sync RPCs recheck persisted ownership. `begin_sleeper_sync` uses an advisory provider/league lock and unique connection constraint for idempotent first import. First importer becomes CommishHQ commissioner; this deliberately does not establish Sleeper commissioner ownership. Another account cannot take over a registered league. Actor IDs come from server-verified sessions, never form data.

A two-minute lease and one-active-run index prevent overlapping/stale writes. Refreshes are throttled to 30 seconds and new imports capped at 20/account/hour. A retry expires abandoned runs. A killed process can show syncing until that retry; the UI explains it. For new leagues, metadata is validated before creating a database identity, so missing/nonexistent league failures do not create invented records. Existing refreshes acquire a lease before provider calls so failures are recorded.

`finish_sleeper_sync` locks the league, verifies owner/lease/connection/week, upserts stable team IDs and replaces provider-manager references and current-week matchup rows in one transaction. Matchups are unique by league/week/team with same-league opponent foreign keys and nullable scores. Failed persistence rolls back completely. Failures retain the previous snapshot and mark the league/run failed; last_synced_at only advances after success. A stale failed attempt cannot overwrite a newer run's state.

Removed rosters become inactive; team rows and approved memberships are preserved. Inactive teams cannot receive new approvals. Provider ownership changes never overwrite approved CommishHQ identities. Reassignment/revocation requires a later explicit workflow and is not included here.

## Three identities

- Supabase/CommishHQ user: profiles.id.
- Sleeper user: provider_managers, linked to imported teams through team_provider_managers (including co-owners).
- Approved CommishHQ league/team identity: league_members.

The claim URL is navigation, not authority. Authentication preserves its safe local destination through sign-in/email confirmation. A narrow claim_options RPC exposes only league name/season and active team names/availability to signed-in visitors knowing the link. It excludes other requests, provider identities, membership identities, standings and scores. This invitation projection is an intentional exception to member-only data access, not a broad teams SELECT policy.

Request identity comes from auth.uid(); its account email label comes from auth.users and is visible only to requester/commissioner. Labels are never used for authorization. Pending claims confer no membership or league read access. Managers may cancel pending requests. Commissioners must confirm the actual requester with the manager they know before approving.

## Database authorization and atomic review

Public claim RPCs are security-invoker wrappers around guarded functions in non-exposed private schema. Security-definer functions use empty search_path and qualified objects. PUBLIC/anon execute is revoked; authenticated grants are narrowly specified. The database derives requester/reviewer from auth.uid(), not caller-supplied IDs. Server actions independently authenticate and verify commissioner plus claim/league association.

Approval locks league then claim, verifies current commissioner, pending state and active team, creates membership and marks approved atomically. Shared league locks serialize approvals with sync. Unique membership keys enforce one user/team in each direction; composite foreign keys reject cross-league teams. Partial indexes block duplicate active claims and duplicate approved teams. Failure leaves the claim pending. No ordinary browser table writes can assign memberships or edit approval records, even for a commissioner.

All new public tables have RLS and SELECT-only authenticated access. Membership/commissioner predicates restrict league records; claims are requester-or-commissioner; sync history is commissioner-only. Secret possession is never the server authorization decision. Phase 1 RLS/profile privacy remain unchanged. Both earlier migrations remain immutable; the third migration upgrades existing Phase 2 records, preserves approved membership and replaces the earlier reviewer-argument RPC. Pause earlier app traffic until the migration and new app deployment are complete.

## UI and runtime

League pages live under Home, preserving the four-area navigation. Missing config/migrations produce setup feedback. Actions report pending/error/success states; stale data is labeled. No fake imported data or later-phase functionality. PWA caches only static offline fallback; authenticated pages are private/no-store. Cloudflare integration remains vinext with no paid bindings or scheduled services. Runtime keys use Worker secret storage. Builds run sequentially; stop Windows preview before rebuilding.

## Verification and limitations

Tests cover schemas, HTTP failures, mapping, standings, redirect preservation, trusted server orchestration, actual migration SQL, RLS/grants and transactional constraints. PGlite simulates Supabase Auth roles/schema only; application SQL runs unchanged. Concurrent Promise submissions verify a single successful approval and rollback. PGlite serializes queries in one backend: these are not live multi-connection lock stress tests. Postgres row locks and unique constraints enforce the production guarantee; hosted Auth/PostgREST and real network races remain deployment smoke tests.

Logs have fixed event names, league UUID, outcome code and timestamp only. No request bodies, raw provider payloads, auth secrets, email labels or arbitrary error objects are logged. No background polling; monitor free-tier quotas. Sleeper's current documentation asks commercial users to discuss licensing.

Official references: [Sleeper API](https://docs.sleeper.com/), [Supabase keys](https://supabase.com/docs/guides/api/api-keys), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Cloudflare Next.js](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/).
