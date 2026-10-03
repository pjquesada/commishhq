# Security

CommishHQ treats the database as the authorization boundary. A signed-in user is not allowed to mutate a league unless a security-definer function confirms that relationship from `auth.uid()`.

## Voting

- One approved team, one ballot. Eligibility is frozen when the vote opens.
- Anonymous ballots are stored without `team_id`. Revealable identities stay hidden until the vote is closed and the commissioner publishes them.
- Open votes expose only `votes_cast / eligible_count`. Tallies are written at finalization, after `closes_at`. A check constraint rejects stored tallies while a vote is draft or open.
- Clients have no table privileges on ballot rows. Casting goes through `cast_trade_ballot`, which uses `auth.uid()`.
- Privacy mode and the veto threshold cannot change after open.
- Turnstile is required when either the site key or the secret is set.

## Push

- Subscription endpoints and keys have no client `SELECT`. Users manage their own devices through RPCs.
- Commissioners see a boolean, not the endpoint.
- Notification URLs are navigation only. They do not authorize the page.
- Delivery uses the outbox `dedupe_key`. HTTP 404 and 410 revoke that subscription.
- `VAPID_PRIVATE_KEY` is server-only.

## Provider credentials

- Yahoo refresh tokens and experimental ESPN session cookies are AES-GCM ciphertext.
- `PROVIDER_TOKEN_ENCRYPTION_KEY` is server-only. Authenticated roles cannot select `provider_credentials`.
- OAuth `state` is stored as a SHA-256 hash, checked against an httpOnly cookie, and consumed once.
- ESPN private cookies are rejected unless `ENABLE_ESPN_EXPERIMENTAL=true`.
- Logs record event, provider, and outcome. They do not record tokens, cookies, or push endpoints.

## Database functions

Security-definer functions set `search_path` to empty, qualify objects, revoke `PUBLIC` execute, and grant only `authenticated` or `service_role` as required. New migrations are forward-only.

## What was not live-tested

CI uses PGlite, fixtures, and mocks. Hosted Supabase, Cloudflare, Yahoo, and ESPN were not called from this build.
