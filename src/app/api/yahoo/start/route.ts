import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient, adminConfigured } from "@/lib/supabase/admin";
import { authorizeUrl, hashState, newOauthState, yahooConfigured } from "@/lib/fantasy/providers/yahoo/oauth";

export async function GET(request: Request) {
  const user = await requireUser("/leagues/yahoo");
  if (!yahooConfigured() || !adminConfigured()) {
    return NextResponse.redirect(new URL("/leagues/yahoo?setup=1", request.url));
  }
  const state = newOauthState();
  const admin = createAdminClient();
  const saved = await admin.rpc("store_oauth_state", {
    actor: user.id,
    provider: "yahoo",
    state_hash: await hashState(state),
  });
  if (saved.error) return NextResponse.redirect(new URL("/leagues/yahoo?error=1", request.url));
  const jar = await cookies();
  jar.set("commishhq_yahoo_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(state));
}
