import "server-only";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient, adminConfigured } from "@/lib/supabase/admin";
import { encryptSecret, decryptSecret } from "@/lib/crypto/tokens";
import { YahooClient, YahooError } from "@/lib/fantasy/providers/yahoo/client";
import { YahooAdapter } from "@/lib/fantasy/providers/yahoo/adapter";
import { refreshAccessToken } from "@/lib/fantasy/providers/yahoo/oauth";
import { databaseError, LeagueError, uuidSchema } from "./models";
import { leagueLog } from "./log";

const storedSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
});
const sealedSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  key_version: z.literal(1),
});

function encryptionKey(): string {
  const key = process.env.PROVIDER_TOKEN_ENCRYPTION_KEY;
  if (!key) throw new LeagueError("Yahoo is not configured on the server.");
  return key;
}

export async function yahooAccessToken(userId: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!adminConfigured()) throw new LeagueError("Yahoo import needs the server-only Supabase secret.");
  const admin = createAdminClient();
  const loaded = await admin.rpc("read_provider_credential", { actor: userId, provider: "yahoo" });
  const sealed = sealedSchema.safeParse(loaded.data);
  if (!sealed.success) throw new LeagueError("Connect Yahoo before importing a league.");
  const parsed = storedSchema.parse(
    JSON.parse(
      await decryptSecret(
        { ciphertext: sealed.data.ciphertext, iv: sealed.data.iv, keyVersion: 1 },
        encryptionKey(),
      ),
    ),
  );
  if (parsed.expiresAt > Date.now() + 60_000) return parsed.accessToken;
  try {
    const refreshed = await refreshAccessToken(parsed.refreshToken, fetcher);
    const next = {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: Date.now() + refreshed.expires_in * 1000,
    };
    const sealedNext = await encryptSecret(JSON.stringify(next), encryptionKey());
    const saved = await admin.rpc("store_provider_credential", {
      actor: userId,
      provider: "yahoo",
      token_ciphertext: sealedNext.ciphertext,
      token_iv: sealedNext.iv,
      version: sealedNext.keyVersion,
    });
    if (saved.error) throw new LeagueError("Yahoo needs to be connected again.");
    return next.accessToken;
  } catch (error) {
    if (error instanceof LeagueError) throw error;
    await admin.rpc("service_revoke_provider_credential", { actor: userId, provider: "yahoo" });
    throw new LeagueError("Yahoo needs to be connected again.");
  }
}

export async function syncYahooLeague(leagueKey: string): Promise<string> {
  const user = await requireUser();
  if (!/^[0-9]{2,6}\.l\.[0-9]{1,12}$/.test(leagueKey))
    throw new LeagueError("Choose a Yahoo league from the list.");
  const token = await yahooAccessToken(user.id);
  const adapter = new YahooAdapter(new YahooClient(token), leagueKey);
  const league = await adapter.getLeague();
  const admin = createAdminClient();
  const begin = await admin.rpc("begin_yahoo_sync", {
    actor: user.id,
    external_league: leagueKey,
    league_name: league.name,
    league_season: league.season,
  });
  if (begin.error) throw databaseError(begin.error.message);
  const lease = z.object({ league_id: uuidSchema, run_id: uuidSchema }).parse(begin.data);
  leagueLog("sync_started", lease.league_id);
  try {
    const [teams, matchups] = await Promise.all([
      adapter.getTeams(),
      league.currentWeek ? adapter.getMatchups(league.currentWeek) : Promise.resolve([]),
    ]);
    const history =
      league.currentWeek && adapter.capabilities().matchupHistory
        ? await adapter.getMatchupHistory(league.currentWeek)
        : [];
    const result = await admin.rpc("finish_yahoo_sync", {
      actor: user.id,
      run: lease.run_id,
      snapshot: {
        league,
        teams,
        managers: [],
        matchups,
        history,
      },
    });
    if (result.error) throw databaseError(result.error.message);
    leagueLog("sync_complete", lease.league_id);
    return lease.league_id;
  } catch (error) {
    const reason = error instanceof YahooError ? "provider" : "persistence";
    await admin.rpc("fail_sleeper_sync", { actor: user.id, run: lease.run_id, reason });
    leagueLog("sync_failed", lease.league_id, reason);
    throw error;
  }
}
