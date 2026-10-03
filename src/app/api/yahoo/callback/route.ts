import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto/tokens";
import { exchangeCode, hashState, statesMatch } from "@/lib/fantasy/providers/yahoo/oauth";

export async function GET(request: Request) {
  const user = await requireUser("/leagues/yahoo");
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const jar = await cookies();
  const cookieState = jar.get("commishhq_yahoo_state")?.value ?? "";
  jar.delete("commishhq_yahoo_state");
  const failed = NextResponse.redirect(new URL("/leagues/yahoo?error=1", request.url));
  if (!code || !statesMatch(cookieState, state)) return failed;
  const admin = createAdminClient();
  const consumed = await admin.rpc("consume_oauth_state", {
    actor: user.id,
    provider: "yahoo",
    state_hash: await hashState(state),
  });
  if (consumed.error || consumed.data !== true) return failed;
  try {
    const token = await exchangeCode(code);
    const sealed = await encryptSecret(
      JSON.stringify({
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + token.expires_in * 1000,
      }),
      process.env.PROVIDER_TOKEN_ENCRYPTION_KEY ?? "",
    );
    const stored = await admin.rpc("store_provider_credential", {
      actor: user.id,
      provider: "yahoo",
      token_ciphertext: sealed.ciphertext,
      token_iv: sealed.iv,
      version: sealed.keyVersion,
    });
    if (stored.error) return failed;
    console.info(JSON.stringify({ event: "oauth_connected", provider: "yahoo", at: new Date().toISOString() }));
    return NextResponse.redirect(new URL("/leagues/yahoo", request.url));
  } catch {
    console.info(JSON.stringify({ event: "oauth_failed", provider: "yahoo", at: new Date().toISOString() }));
    return failed;
  }
}
