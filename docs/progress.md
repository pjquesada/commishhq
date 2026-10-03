# Progress

## Completed

- Phase 1 foundation on `main` (`3b8e830`)
- Phase 2 Sleeper import and claims on `phase-2-sleeper-import` (`039d2d3`)
- Phase 3 secure trade voting on `full-app-build`
- Phase 4 standards-based Web Push
- Phase 5 weekly recap engine and Tuesday scheduler
- Phase 6 Yahoo Fantasy OAuth
- Phase 7 ESPN public read, with experimental private sessions off by default

## Current

Draft pull request: https://github.com/pjquesada/commishhq/pull/2

## Remaining

- Manual Supabase, Cloudflare, VAPID, Yahoo, and ESPN setup. Do not merge the draft.

## Decisions

- Voting authority is `auth.uid()` plus an approved team. Anonymous ballots have no `team_id`.
- Open votes expose only `votes_cast / eligible_count` through `trade_vote_progress`. Choice rows have no client privileges.
- Tallies are written only when a vote is finalized after `closes_at`. Reads finalize overdue votes; casting after the deadline is rejected and does not roll back that close.
- Privacy mode and the veto threshold cannot change after the vote leaves draft. Publish opens the vote in the same transaction.
- Turnstile is required for ballots only when the site key or secret is configured. Production must set both.
- Deadlines are wall-clock times in the league IANA timezone.
- Web Push uses Web Crypto (RFC 8291 AES-128-GCM and VAPID ES256). Invalid endpoints (404/410) are revoked. Subscription rows have no client SELECT.
- Notifications go through `notification_outbox` with a unique `dedupe_key`. Vote-open rows are enqueued from the audit trigger for eligible teams only.
- Cloudflare Cron calls the worker `scheduled` handler, which POSTs `/api/internal/scheduler` with `CRON_SECRET`. vinext only exports `fetch`, so `scripts/attach-scheduled.mjs` attaches `scheduled` after `vinext build`.
- Weekly recaps are deterministic first. Workers AI (`RECAP_AI_MODEL`, default `@cf/zai-org/glm-4.7-flash`) may polish text and is discarded when it adds numbers or fails. One row per league, season, and week. Tuesday 9:00 is computed in the league IANA timezone; other days are catch-up only.
- Vocabulary is global. Cooldowns are per league and per phrase family. Bench jokes stay at team level.
- League refresh follows the stored connection provider. A Yahoo or ESPN league is not sent through the Sleeper client.
- Open `trade_votes` rows cannot store tallies. A check constraint requires `approve_count` and `veto_count` to be null until the vote is closed.

## Manual configuration

- Apply every migration in `supabase/migrations` in filename order, through `20261002240000_phase7_espn.sql`. Do not reset a hosted database.
- Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` before a public beta.
- Generate a VAPID key pair. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. Set `CRON_SECRET` as a Worker secret.
- Optional Workers AI binding `AI` on the Worker. If it is missing, recaps still publish.
- Yahoo: create an app with scope `fspt-r`, set `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REDIRECT_URI` (`/api/yahoo/callback`), and `PROVIDER_TOKEN_ENCRYPTION_KEY` (32-byte base64). Fantasy API access may still require Yahoo's approval.
- ESPN public import uses the unofficial read endpoint and is labeled as such. Private `espn_s2` / `SWID` storage stays off unless `ENABLE_ESPN_EXPERIMENTAL=true`.
