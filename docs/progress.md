# Progress

## Completed

- Phase 1 foundation on `main` (`3b8e830`)
- Phase 2 Sleeper import and claims on `phase-2-sleeper-import` (`039d2d3`)
- Phase 3 secure trade voting on `full-app-build`
- Phase 4 standards-based Web Push

## Current

Phase 5 weekly recap engine and Tuesday scheduler.

## Remaining

- Phase 5 weekly recap engine, vocabulary, Tuesday scheduler
- Phase 6 Yahoo Fantasy OAuth
- Phase 7 ESPN public read and gated experimental private credentials
- Final security review, documentation, draft pull request

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

## Manual configuration

- Apply `20261002190000_phase3_trade_voting.sql` and `20261002200000_phase4_web_push.sql` after the Phase 2 migrations. Do not reset a hosted database.
- Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` before a public beta.
- Generate a VAPID key pair. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. Set `CRON_SECRET` as a Worker secret.
- Workers AI, Yahoo, and ESPN credentials are not wired yet.
