import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { listLeagues } from "@/lib/leagues/queries";
import { LeagueError, uuidSchema } from "@/lib/leagues/models";

const recapListSchema = z.object({
  id: uuidSchema,
  league_id: uuidSchema,
  season: z.number(),
  week: z.number(),
  status: z.enum(["published", "edited"]),
  published_at: z.string(),
});
const recapSchema = recapListSchema.extend({
  body: z.string(),
  settings_snapshot: z.record(z.string(), z.unknown()),
});

export async function listRecaps(leagueId?: string) {
  await requireUser("/recaps");
  const client = await createClient();
  let query = client
    .from("weekly_recaps")
    .select("id,league_id,season,week,status,published_at")
    .order("season", { ascending: false })
    .order("week", { ascending: false });
  if (leagueId) query = query.eq("league_id", leagueId);
  const [recaps, leagues] = await Promise.all([query, listLeagues()]);
  if (recaps.error) return { recaps: [], leagues };
  return { recaps: z.array(recapListSchema).parse(recaps.data ?? []), leagues };
}

export async function getRecap(leagueId: string, week: number) {
  const user = await requireUser(`/leagues/${leagueId}/recaps/${week}`);
  if (!uuidSchema.safeParse(leagueId).success || week < 1 || week > 22)
    throw new LeagueError("Recap not found.");
  const client = await createClient();
  const recap = await client
    .from("weekly_recaps")
    .select("id,league_id,season,week,status,published_at,body,settings_snapshot")
    .eq("league_id", leagueId)
    .eq("week", week)
    .maybeSingle();
  if (recap.error || !recap.data) throw new LeagueError("Recap not found.");
  const parsed = recapSchema.parse(recap.data);
  const sections = await client
    .from("weekly_recap_team_sections")
    .select("team_id,section_body,short_notification")
    .eq("recap_id", parsed.id);
  const league = await client.from("leagues").select("name,commissioner_id").eq("id", leagueId).maybeSingle();
  return {
    user,
    recap: parsed,
    sections: sections.data ?? [],
    leagueName: league.data?.name ?? "League",
    commissioner: league.data?.commissioner_id === user.id,
  };
}

export async function leagueHighlights(leagueId: string) {
  try {
    const client = await createClient();
    const [recap, vote] = await Promise.all([
      client
        .from("weekly_recaps")
        .select("week")
        .eq("league_id", leagueId)
        .order("week", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from("trade_votes")
        .select("id")
        .eq("league_id", leagueId)
        .eq("status", "open")
        .limit(1)
        .maybeSingle(),
    ]);
    return {
      week: recap.data?.week ?? null,
      voteId: vote.data?.id ?? null,
    };
  } catch {
    return { week: null, voteId: null };
  }
}
