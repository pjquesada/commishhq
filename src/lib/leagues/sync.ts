import "server-only";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient, adminConfigured } from "@/lib/supabase/admin";
import { sleeperProvider } from "@/lib/fantasy/providers/sleeper";
import { sleeperIdSchema } from "@/lib/fantasy/providers/sleeper/schemas";
import { ProviderError } from "@/lib/fantasy/providers/sleeper/client";
import { getLeague } from "./queries";
import { LeagueError, databaseError, uuidSchema } from "./models";
import { leagueLog } from "./log";
export async function syncSleeperLeague(
  externalId: string,
  localId?: string,
): Promise<string> {
  const user = await requireUser();
  if (!adminConfigured())
    throw new LeagueError(
      "League importing needs the server-only Supabase secret. See the Phase 2 setup instructions.",
    );
  const external = sleeperIdSchema.safeParse(externalId);
  if (!external.success)
    throw new LeagueError("Enter a Sleeper League ID using digits only.");
  const adapter = sleeperProvider(external.data);
  // For refresh, check membership/ownership before constructing the privileged client or fetching Sleeper.
  const existing = localId ? await getLeague(localId) : null;
  if (existing && existing.league.commissioner_id !== user.id)
    throw new LeagueError("Only the commissioner can sync this league.");
  if (existing) {
    const connection = await existing.client
      .from("league_connections")
      .select("external_id,provider")
      .eq("league_id", localId!)
      .single();
    if (
      connection.error ||
      connection.data?.provider !== "sleeper" ||
      connection.data.external_id !== external.data
    )
      throw new LeagueError("Invalid league connection.");
  }
  const initial = existing ? null : await adapter.getLeague();
  const admin = createAdminClient();
  const begin = await admin.rpc("begin_sleeper_sync", {
    actor: user.id,
    external_league: external.data,
    league_name: existing?.league.name ?? initial!.name,
    league_season: existing?.league.season ?? initial!.season,
  });
  if (begin.error) throw databaseError(begin.error.message);
  const lease = z
    .object({ league_id: uuidSchema, run_id: uuidSchema })
    .parse(begin.data);
  leagueLog("sync_started", lease.league_id);
  try {
    const league = initial ?? (await adapter.getLeague());
    const [teams, managers, matchups] = await Promise.all([
      adapter.getTeams(),
      adapter.getManagers(),
      league.currentWeek === null
        ? Promise.resolve([])
        : adapter.getMatchups(league.currentWeek),
    ]);
    const result = await admin.rpc("finish_sleeper_sync", {
      actor: user.id,
      run: lease.run_id,
      snapshot: { league, teams, managers, matchups },
    });
    if (result.error) throw databaseError(result.error.message);
    leagueLog("sync_complete", lease.league_id);
    return lease.league_id;
  } catch (error) {
    const reason = error instanceof ProviderError ? "provider" : "persistence";
    const failed = await admin.rpc("fail_sleeper_sync", {
      actor: user.id,
      run: lease.run_id,
      reason,
    });
    leagueLog("sync_failed", lease.league_id, reason);
    if (failed.error)
      throw new LeagueError(
        "Sync failed and its status could not be saved. Refresh the page; an interrupted sync can be retried after two minutes.",
      );
    throw error;
  }
}
