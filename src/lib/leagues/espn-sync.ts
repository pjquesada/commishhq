import "server-only";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient, adminConfigured } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/crypto/tokens";
import { EspnClient, EspnError, espnExperimentalEnabled, redactEspn } from "@/lib/fantasy/providers/espn/client";
import { databaseError, LeagueError, uuidSchema } from "./models";
import { leagueLog } from "./log";

const sealedSchema = z.object({ ciphertext: z.string(), iv: z.string(), key_version: z.literal(1) });
const sessionSchema = z.object({ espnS2: z.string().min(10), swid: z.string().min(3) });

export async function saveEspnSession(espnS2: string, swid: string) {
  const user = await requireUser();
  if (!espnExperimentalEnabled()) throw new LeagueError("Experimental ESPN private leagues are turned off.");
  if (!adminConfigured()) throw new LeagueError("ESPN import needs the server-only Supabase secret.");
  const parsed = sessionSchema.safeParse({ espnS2, swid });
  if (!parsed.success) throw new LeagueError("Those ESPN session values could not be saved.");
  const key = process.env.PROVIDER_TOKEN_ENCRYPTION_KEY;
  if (!key) throw new LeagueError("ESPN session storage is not configured.");
  const sealed = await encryptSecret(JSON.stringify(parsed.data), key);
  const admin = createAdminClient();
  const saved = await admin.rpc("store_provider_credential", {
    actor: user.id,
    provider: "espn",
    token_ciphertext: sealed.ciphertext,
    token_iv: sealed.iv,
    version: sealed.keyVersion,
  });
  if (saved.error) throw databaseError(saved.error.message);
}

async function savedSession(userId: string): Promise<{ espnS2: string; swid: string } | undefined> {
  if (!espnExperimentalEnabled()) return undefined;
  const key = process.env.PROVIDER_TOKEN_ENCRYPTION_KEY;
  if (!key || !adminConfigured()) return undefined;
  const admin = createAdminClient();
  const loaded = await admin.rpc("read_provider_credential", { actor: userId, provider: "espn" });
  const sealed = sealedSchema.safeParse(loaded.data);
  if (!sealed.success) return undefined;
  const parsed = sessionSchema.safeParse(
    JSON.parse(
      await decryptSecret(
        { ciphertext: sealed.data.ciphertext, iv: sealed.data.iv, keyVersion: 1 },
        key,
      ),
    ),
  );
  return parsed.success ? parsed.data : undefined;
}

export async function syncEspnLeague(leagueId: string, season: number) {
  const user = await requireUser();
  if (!/^\d{1,12}$/.test(leagueId) || season < 2000 || season > 2200)
    throw new LeagueError("Enter an ESPN league ID and season.");
  if (!adminConfigured()) throw new LeagueError("ESPN import needs the server-only Supabase secret.");
  const session = await savedSession(user.id);
  const client = new EspnClient(leagueId, season, fetch, session);
  let snapshot;
  try {
    snapshot = await client.snapshot();
  } catch (error) {
    const message = error instanceof EspnError ? error.message : "ESPN did not return usable league data.";
    throw new LeagueError(redactEspn(message));
  }
  const admin = createAdminClient();
  const begin = await admin.rpc("begin_espn_sync", {
    actor: user.id,
    external_league: leagueId,
    league_name: snapshot.league.name,
    league_season: snapshot.league.season,
  });
  if (begin.error) throw databaseError(begin.error.message);
  const lease = z.object({ league_id: uuidSchema, run_id: uuidSchema }).parse(begin.data);
  leagueLog("sync_started", lease.league_id);
  const result = await admin.rpc("finish_espn_sync", {
    actor: user.id,
    run: lease.run_id,
    snapshot: { ...snapshot, managers: [] },
  });
  if (result.error) {
    await admin.rpc("fail_sleeper_sync", { actor: user.id, run: lease.run_id, reason: "persistence" });
    leagueLog("sync_failed", lease.league_id, "persistence");
    throw databaseError(result.error.message);
  }
  leagueLog("sync_complete", lease.league_id);
  return lease.league_id;
}
