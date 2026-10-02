import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { databaseError, uuidSchema, LeagueError } from "@/lib/leagues/models";
import { utcToZonedInput } from "@/lib/time";

const voteSchema = z.object({
  id: uuidSchema,
  league_id: uuidSchema,
  commissioner_id: uuidSchema,
  status: z.enum(["draft", "open", "closed", "cancelled"]),
  privacy_mode: z.enum(["anonymous", "commissioner_may_reveal_after_close"]),
  participants_may_vote: z.boolean(),
  required_veto_votes: z.number(),
  opens_at: z.string(),
  closes_at: z.string(),
  outcome: z.enum(["pending", "approved", "vetoed", "cancelled"]),
  approve_count: z.number().nullable(),
  veto_count: z.number().nullable(),
  identities_published: z.boolean(),
});
const sideSchema = z.object({
  id: uuidSchema,
  vote_id: uuidSchema,
  league_id: uuidSchema,
  team_id: uuidSchema,
  side_index: z.number(),
});
const assetSchema = z.object({
  id: uuidSchema,
  side_id: uuidSchema,
  vote_id: uuidSchema,
  asset_type: z.enum(["player", "draft_pick", "faab", "custom"]),
  label: z.string(),
  sort_order: z.number(),
});
const progressSchema = z.object({
  votes_cast: z.number(),
  eligible_count: z.number(),
  status: z.enum(["draft", "open", "closed", "cancelled"]),
  outcome: z.enum(["approved", "vetoed", "cancelled"]).nullable(),
  viewer_eligible: z.boolean(),
  viewer_has_voted: z.boolean(),
});
const resultsSchema = z.object({
  status: z.string(),
  outcome: z.string(),
  approve_count: z.number().nullable(),
  veto_count: z.number().nullable(),
  required_veto_votes: z.number().optional(),
  identities: z
    .array(z.object({ team_id: uuidSchema, choice: z.enum(["approve", "veto"]) }))
    .nullable(),
});
export type TradeVote = z.infer<typeof voteSchema>;
export type TradeProgress = z.infer<typeof progressSchema>;
export type TradeResults = z.infer<typeof resultsSchema>;

async function clientFor(next: string) {
  await requireUser(next);
  const client = await createClient();
  const finalized = await client.rpc("finalize_visible_due_votes");
  if (finalized.error) throw databaseError(finalized.error.message);
  return client;
}

export async function listVotes(leagueId?: string) {
  const client = await clientFor("/trades");
  const [votes, sides, assets, teams, leagues] = await Promise.all([
    client.from("trade_votes").select("*").order("closes_at", { ascending: true }),
    client.from("trade_sides").select("*"),
    client.from("trade_assets").select("*"),
    client.from("teams").select("id,name,league_id").eq("active", true),
    client.from("leagues").select("id,name,timezone,commissioner_id"),
  ]);
  for (const result of [votes, sides, assets, teams, leagues])
    if (result.error) throw databaseError(result.error.message);
  const parsedVotes = z.array(voteSchema).parse(votes.data);
  const scoped = leagueId
    ? parsedVotes.filter((vote) => vote.league_id === leagueId)
    : parsedVotes;
  const progressEntries = await Promise.all(
    scoped
      .filter((vote) => vote.status === "open")
      .map(async (vote) => {
        const progress = await client.rpc("trade_vote_progress", { target_vote: vote.id });
        if (progress.error) throw databaseError(progress.error.message);
        return [vote.id, progressSchema.parse(progress.data)] as const;
      }),
  );
  return {
    votes: scoped,
    sides: z.array(sideSchema).parse(sides.data),
    assets: z.array(assetSchema).parse(assets.data),
    teams: z
      .array(z.object({ id: uuidSchema, name: z.string(), league_id: uuidSchema }))
      .parse(teams.data),
    leagues: z
      .array(
        z.object({
          id: uuidSchema,
          name: z.string(),
          timezone: z.string(),
          commissioner_id: uuidSchema,
        }),
      )
      .parse(leagues.data),
    progress: new Map(progressEntries),
  };
}

export async function getVote(leagueId: string, voteId: string) {
  if (!uuidSchema.safeParse(leagueId).success || !uuidSchema.safeParse(voteId).success)
    throw new LeagueError("Vote not found.");
  const data = await listVotes(leagueId);
  const vote = data.votes.find((item) => item.id === voteId);
  if (!vote) throw new LeagueError("Vote not found.");
  const client = await createClient();
  const progress = await client.rpc("trade_vote_progress", { target_vote: voteId });
  if (progress.error) throw databaseError(progress.error.message);
  const parsedProgress = progressSchema.parse(progress.data);
  let results: TradeResults | null = null;
  if (parsedProgress.status === "closed" || parsedProgress.status === "cancelled") {
    const loaded = await client.rpc("trade_vote_results", { target_vote: voteId });
    if (loaded.error) throw databaseError(loaded.error.message);
    results = resultsSchema.parse(loaded.data);
  }
  return { ...data, vote, progress: parsedProgress, results };
}

export async function getTradeComposer(leagueId: string) {
  const user = await requireUser(`/leagues/${leagueId}/trades/new`);
  if (!uuidSchema.safeParse(leagueId).success)
    throw new LeagueError("League not found or access not approved.");
  const client = await createClient();
  const [league, teams, preferences] = await Promise.all([
    client.from("leagues").select("id,name,timezone,commissioner_id").eq("id", leagueId).maybeSingle(),
    client.from("teams").select("id,name").eq("league_id", leagueId).eq("active", true),
    client.from("league_preferences").select("participants_may_vote,default_vote_hours").eq("league_id", leagueId).maybeSingle(),
  ]);
  if (league.error || teams.error || preferences.error)
    throw databaseError((league.error || teams.error || preferences.error)!.message);
  if (!league.data) throw new LeagueError("League not found or access not approved.");
  const parsed = z
    .object({
      id: uuidSchema,
      name: z.string(),
      timezone: z.string(),
      commissioner_id: uuidSchema,
    })
    .parse(league.data);
  if (parsed.commissioner_id !== user.id)
    throw new LeagueError("Only the commissioner can open a trade vote.");
  const voting = z
    .object({
      participants_may_vote: z.boolean(),
      default_vote_hours: z.number(),
    })
    .nullable()
    .parse(preferences.data) ?? {
    participants_may_vote: false,
    default_vote_hours: 48,
  };
  return {
    user,
    league: parsed,
    teams: z.array(z.object({ id: uuidSchema, name: z.string() })).parse(teams.data),
    preferences: voting,
    defaultDeadline: utcToZonedInput(
      new Date(Date.now() + voting.default_vote_hours * 60 * 60 * 1000),
      parsed.timezone,
    ),
  };
}
