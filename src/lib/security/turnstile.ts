import "server-only";

/** Defense in depth. Missing configuration fails closed only when a site key is set. */
export async function verifyTurnstile(token: FormDataEntryValue | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const site = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!site && !secret) return true;
  if (!site || !secret || typeof token !== "string" || token.length < 1) return false;
  const body = new URLSearchParams({ secret, response: token });
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body },
  );
  if (!response.ok) return false;
  const payload: unknown = await response.json();
  return (
    typeof payload === "object" &&
    payload !== null &&
    "success" in payload &&
    payload.success === true
  );
}
