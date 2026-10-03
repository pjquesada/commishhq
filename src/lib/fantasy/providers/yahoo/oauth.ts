const encoder = new TextEncoder();

export function yahooConfigured(): boolean {
  return Boolean(
    process.env.YAHOO_CLIENT_ID &&
      process.env.YAHOO_CLIENT_SECRET &&
      process.env.YAHOO_REDIRECT_URI &&
      process.env.PROVIDER_TOKEN_ENCRYPTION_KEY,
  );
}

export function newOauthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));
  return base64Url(bytes);
}

export async function hashState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(state));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function statesMatch(left: string, right: string): boolean {
  if (left.length !== right.length || left.length < 16) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function base64Url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function authorizeUrl(state: string): string {
  const url = new URL("https://api.login.yahoo.com/oauth2/request_auth");
  url.searchParams.set("client_id", process.env.YAHOO_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", process.env.YAHOO_REDIRECT_URI ?? "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "fspt-r");
  url.searchParams.set("state", state);
  return url.toString();
}

export interface YahooTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

const tokenSchema = {
  parse(value: unknown): YahooTokenResponse {
    if (!value || typeof value !== "object") throw new Error("Yahoo token response was incomplete");
    const row = value as Record<string, unknown>;
    if (typeof row.access_token !== "string" || typeof row.refresh_token !== "string")
      throw new Error("Yahoo token response was incomplete");
    const expires = Number(row.expires_in);
    if (!Number.isFinite(expires) || expires <= 0) throw new Error("Yahoo token response was incomplete");
    return { access_token: row.access_token, refresh_token: row.refresh_token, expires_in: expires };
  },
};

async function tokenRequest(body: URLSearchParams, fetcher: typeof fetch): Promise<YahooTokenResponse> {
  const id = process.env.YAHOO_CLIENT_ID ?? "";
  const secret = process.env.YAHOO_CLIENT_SECRET ?? "";
  const response = await fetcher("https://api.login.yahoo.com/oauth2/get_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  if (!response.ok) throw new Error("Yahoo token exchange failed");
  return tokenSchema.parse(await response.json());
}

export function exchangeCode(code: string, fetcher: typeof fetch = fetch) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    redirect_uri: process.env.YAHOO_REDIRECT_URI ?? "",
    code,
  });
  return tokenRequest(body, fetcher);
}

export function refreshAccessToken(refreshToken: string, fetcher: typeof fetch = fetch) {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  return tokenRequest(body, fetcher);
}
