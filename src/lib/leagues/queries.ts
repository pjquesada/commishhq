import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import {
  leagueRowSchema,
  teamRowSchema,
  matchupRowSchema,
  claimRowSchema,
  claimOptionsSchema,
  uuidSchema,
  LeagueError,
  databaseError,
} from "./models";
export async function listLeagues() {
  await requireUser();
  const client = await createClient();
  const { data, error } = await client
    .from("leagues")
    .select(
      "id,name,season,commissioner_id,current_week,sync_status,last_synced_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw databaseError(error.message);
  return z.array(leagueRowSchema).parse(data);
}
export async function getLeague(id: string) {
  const user = await requireUser(`/leagues/${id}`);
  if (!uuidSchema.safeParse(id).success)
    throw new LeagueError("League not found or access not approved.");
  const client = await createClient();
  const { data, error } = await client
    .from("leagues")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw databaseError(error.message);
  if (!data) throw new LeagueError("League not found or access not approved.");
  return { user, league: leagueRowSchema.parse(data), client };
}
export async function getDashboard(id: string) {
  const { user, league, client } = await getLeague(id);
  const [teams, matchups, managers, links, connection] = await Promise.all([
    client.from("teams").select("*").eq("league_id", id).eq("active", true),
    client
      .from("matchups")
      .select("*")
      .eq("league_id", id)
      .eq("week", league.current_week ?? 0),
    client
      .from("provider_managers")
      .select("external_id,display_name")
      .eq("league_id", id),
    client
      .from("team_provider_managers")
      .select("team_id,manager_external_id")
      .eq("league_id", id),
    client
      .from("league_connections")
      .select("provider,external_id")
      .eq("league_id", id)
      .single(),
  ]);
  for (const result of [teams, matchups, managers, links, connection])
    if (result.error) throw databaseError(result.error.message);
  return {
    user,
    league,
    teams: z.array(teamRowSchema).parse(teams.data),
    matchups: z.array(matchupRowSchema).parse(matchups.data),
    managers: z
      .array(z.object({ external_id: z.string(), display_name: z.string() }))
      .parse(managers.data),
    links: z
      .array(z.object({ team_id: uuidSchema, manager_external_id: z.string() }))
      .parse(links.data),
    connection: z
      .object({ provider: z.string(), external_id: z.string() })
      .parse(connection.data),
  };
}
export async function getClaimPage(id: string) {
  const user = await requireUser(`/leagues/${id}/claim`);
  if (!uuidSchema.safeParse(id).success)
    throw new LeagueError("Claim link not found.");
  const client = await createClient();
  const [options, claims] = await Promise.all([
    client.rpc("claim_options", { target: id }),
    client
      .from("team_claims")
      .select("*")
      .eq("league_id", id)
      .eq("requester_id", user.id)
      .order("created_at", { ascending: false }),
  ]);
  if (options.error || claims.error)
    throw databaseError((options.error || claims.error)!.message);
  if (!options.data)
    throw new LeagueError(
      "This league has not completed its first import yet, or the link is invalid.",
    );
  return {
    options: claimOptionsSchema.parse(options.data),
    claims: z.array(claimRowSchema).parse(claims.data),
  };
}
export async function getReviewPage(id: string) {
  const { user, league, client } = await getLeague(id);
  if (league.commissioner_id !== user.id)
    throw new LeagueError("Only the commissioner can review claims.");
  const [claims, teams] = await Promise.all([
    client
      .from("team_claims")
      .select("*")
      .eq("league_id", id)
      .order("created_at", { ascending: false }),
    client.from("teams").select("*").eq("league_id", id),
  ]);
  if (claims.error || teams.error)
    throw databaseError((claims.error || teams.error)!.message);
  return {
    league,
    claims: z.array(claimRowSchema).parse(claims.data),
    teams: z.array(teamRowSchema).parse(teams.data),
  };
}
