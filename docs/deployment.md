# Deployment

Apply migrations in filename order with `npx supabase db push` after linking the project. Do not reset a hosted database. Keep the `private` schema out of the Data API exposed schemas, then run the Supabase security advisor.

## Supabase Auth

- Site URL is `APP_URL`.
- Allow `/auth/callback` and its `next` query.
- Keep email confirmation on and anonymous sign-in off.
- Put the Turnstile secret in Auth CAPTCHA settings. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` together.
- `SUPABASE_SECRET_KEY` is a Worker secret, never a `NEXT_PUBLIC_` variable.

## Cloudflare

`npm run build:vinext` builds the worker and `scripts/attach-scheduled.mjs` adds the cron `scheduled` handler. `wrangler.jsonc` triggers `0 * * * *`.

Worker secrets:

- `SUPABASE_SECRET_KEY`
- `TURNSTILE_SECRET_KEY`
- `CRON_SECRET`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (a `mailto:` address)
- `PROVIDER_TOKEN_ENCRYPTION_KEY`
- `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REDIRECT_URI`
- `RECAP_AI_MODEL` if you override the default `@cf/zai-org/glm-4.7-flash`

Public build variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `APP_URL`.

Generate a VAPID key pair with a Web Crypto or `web-push` tool and store only the public key in the public variable. The hourly cron POSTs `/api/internal/scheduler` with `Authorization: Bearer $CRON_SECRET`.

Optional Workers AI binding name: `AI`. Recaps still publish when it is missing.

## Yahoo

Register a Yahoo application with the `fspt-r` scope. The redirect URI is `{APP_URL}/api/yahoo/callback`. Yahoo may still return 403 until the app is approved for Fantasy Sports.

## ESPN

Leave `ENABLE_ESPN_EXPERIMENTAL=false`. Public league import does not use cookies. Read [integrations](integrations.md) before enabling private session cookies.

## Release check

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run build:vinext
```

No hosted smoke test was run for this beta branch.
