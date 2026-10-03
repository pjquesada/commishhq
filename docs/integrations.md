# Integrations

Decisions below were checked against official documentation while building the beta. Hosted behavior was not exercised in CI.

## Yahoo Fantasy

Official OAuth for a confidential web app:

- Authorize: `https://api.login.yahoo.com/oauth2/request_auth`
- Token: `https://api.login.yahoo.com/oauth2/get_token`
- Fantasy read base: `https://fantasysports.yahooapis.com/fantasy/v2`
- Scope: `fspt-r`
- Token auth: HTTP Basic with the client id and secret

Yahoo's confidential-client token documentation does not specify PKCE. CommishHQ uses a one-time `state` stored as a SHA-256 hash, bound to the signed-in user, and mirrored in an httpOnly cookie. The callback accepts only that pair.

Refresh tokens are rotated by Yahoo. CommishHQ replaces the encrypted blob on each refresh. The blob is AES-GCM with `PROVIDER_TOKEN_ENCRYPTION_KEY` (32 raw bytes, standard base64). Rotate the key by writing a new version, decrypting with the previous version, and encrypting again. Do not commit the key.

Yahoo OAuth proves a Yahoo account. It does not approve a CommishHQ team. Team claims stay commissioner-approved.

Some Yahoo apps still receive HTTP 403 from Fantasy Sports until Yahoo grants API access. That is a Yahoo approval step, not a CommishHQ bug.

## Workers AI

Default model: `@cf/zai-org/glm-4.7-flash` via `RECAP_AI_MODEL`. Recaps publish from the deterministic draft when the binding, quota, or model is unavailable. Paid-only models are not the default.

## ESPN

ESPN does not publish an official fantasy OAuth API for third-party commissioner tools. CommishHQ therefore does not pretend one exists.

Public leagues are read, unofficially, from `lm-api-reads.fantasy.espn.com` using the league ID and season. The screen is labeled unofficial. No cookies are sent for that path.

Private leagues still depend on `espn_s2` and `SWID` session cookies. That path is experimental, off unless `ENABLE_ESPN_EXPERIMENTAL=true`, encrypted with `PROVIDER_TOKEN_ENCRYPTION_KEY`, never logged, and never returned to the browser. Confirm ESPN's terms before offering it in a public commercial release.
