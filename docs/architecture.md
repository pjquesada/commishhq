# CommishHQ architecture through Phase 2

## Scope

CommishHQ is intentionally not a replacement fantasy platform. The current codebase provides account/authentication foundations plus a trustworthy Sleeper league and manager/team identity layer. Trade voting, Web Push, weekly recaps, Yahoo, and ESPN are still future phases.

## Application architecture

1. **Next.js App Router + strict TypeScript.** Server Components render data-heavy pages. Server Actions handle authenticated mutations. Small client components are limited to interaction that requires browser state.
2. **Provider boundary.** `FantasyProvider` exposes normalized league/member/team/matchup/settings models. Sleeper schemas, raw response types, HTTP errors, and mapping rules live only under `src/lib/fantasy/providers/sleeper/`.
3. **Sleeper sync.** `syncSleeperLeague` fetches and validates provider data, normalizes it, then upserts by stable provider IDs. Sync status and run records make partial failures visible without treating them as a successful refresh.
4. **Supabase Auth + Postgres.** The user-scoped SSR client verifies sessions with `getUser()`. A separate server-only admin client uses the Supabase secret key only after application authorization has been established.
5. **RLS first.** Public-schema tables remain RLS protected. Browser clients cannot directly insert/update authoritative league membership or team assignment.
6. **Commissioner-approved claims.** A pending team claim is not membership. Approval is atomic in Postgres; partial unique indexes and composite foreign keys prevent duplicate managers, duplicate team ownership, and cross-league assignments.
7. **Cloudflare deployment.** The Phase 1 vinext/Workers path remains unchanged. No paid bindings or cron jobs are required for Phase 2.
8. **PWA foundation.** The service worker still caches only the static offline page. Push delivery is deliberately deferred to Phase 4.

## Identity and authorization model

There are three separate identities and they must not be conflated:

- **Supabase user** — authenticated CommishHQ account
- **Sleeper provider user** — imported, untrusted provider identity/reference
- **CommishHQ league/team membership** — authoritative application relationship created only after commissioner approval

Entering a Sleeper username or appearing as a Sleeper roster owner does not automatically authorize a CommishHQ account.

The user who first imports a league becomes its CommishHQ commissioner. The server derives the authenticated user from the session; it never accepts a client-supplied user ID as proof of identity.

## Server-only Supabase client

The server admin client exists because imports must write authoritative provider data and claim approval must create memberships without granting broad table writes to every authenticated browser.

Rules:
- Prefer `SUPABASE_SECRET_KEY`.
- Legacy `SUPABASE_SERVICE_ROLE_KEY` is fallback-only.
- Never prefix these with `NEXT_PUBLIC_`.
- Never pass the admin client into React Client Components.
- Authenticate the requester with the normal SSR client first.
- Treat the admin client as a persistence mechanism, not as authorization.

## Sleeper data rules

- Responses are parsed through Zod before mapping.
- League IDs remain opaque external strings.
- Sleeper `fpts_decimal` fields are hundredths: `143 + 52/100 = 143.52`.
- Matchup opponents are paired by `matchup_id`, never response array order.
- Current NFL week is used only when the league season matches the NFL state season.
- Standings currently sort by winning percentage, then points for, then stable provider team ID. This is deliberately not an attempt to replicate every custom Sleeper playoff tiebreaker.

## Phase boundaries

Phase 3 will build secure hidden-result trade ballots on top of the approved `league_members.team_id` identity.

Phase 4 will add standards-based Web Push.

Phase 5 will add deterministic recap facts, vocabulary cooldowns, Tuesday scheduling, and personalized recap notifications.

Do not add those behaviors to Phase 2.
