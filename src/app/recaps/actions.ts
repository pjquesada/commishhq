"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { databaseError, LeagueError, uuidSchema } from "@/lib/leagues/models";
import { isTimeZone } from "@/lib/time";
import { draftRecap } from "@/lib/recaps/draft";
import type { ToneSettings } from "@/lib/recaps/vocabulary";

export interface RecapActionState {
  error?: string;
  message?: string;
}

const toneSchema = z.object({
  trash_talk: z.enum(["light", "normal", "savage"]).default("normal"),
  profanity: z.enum(["clean", "some", "uncensored"]).default("clean"),
  adult_humor: z.boolean().default(false),
  meme_level: z.enum(["low", "medium", "brainrot"]).default("medium"),
  recap_length: z.enum(["quick", "normal", "full"]).default("normal"),
});

function failure(error: unknown): RecapActionState {
  return { error: error instanceof LeagueError ? error.message : "The recap could not be saved." };
}

export async function saveRecapPreferences(
  _state: RecapActionState,
  form: FormData,
): Promise<RecapActionState> {
  await requireUser("/settings");
  const leagueId = uuidSchema.safeParse(form.get("leagueId"));
  const prefs = toneSchema.safeParse({
    trash_talk: form.get("trashTalk"),
    profanity: form.get("profanity"),
    adult_humor: form.get("adultHumor") === "on",
    meme_level: form.get("memeLevel"),
    recap_length: form.get("recapLength"),
  });
  if (!leagueId.success || !prefs.success) return { error: "Invalid recap settings." };
  const client = await createClient();
  const result = await client.rpc("update_league_preferences", {
    target: leagueId.data,
    prefs: prefs.data,
  });
  if (result.error) return failure(databaseError(result.error.message));
  const zone = String(form.get("timezone") ?? "");
  if (zone && isTimeZone(zone)) {
    const savedZone = await client.rpc("set_league_timezone", { target: leagueId.data, zone });
    if (savedZone.error) return failure(databaseError(savedZone.error.message));
  }
  revalidatePath("/settings");
  return { message: "Recap style saved." };
}

function shifted(base: z.infer<typeof toneSchema>, intent: string): ToneSettings {
  const talk = ["light", "normal", "savage"] as const;
  const memes = ["low", "medium", "brainrot"] as const;
  const lengths = ["quick", "normal", "full"] as const;
  let trash = base.trash_talk;
  let meme = base.meme_level;
  let length = base.recap_length;
  let profanity = base.profanity;
  if (intent === "meaner") trash = talk[Math.min(talk.indexOf(trash) + 1, 2)] ?? trash;
  if (intent === "softer") {
    trash = talk[Math.max(talk.indexOf(trash) - 1, 0)] ?? trash;
    profanity = "clean";
  }
  if (intent === "funnier") meme = memes[Math.min(memes.indexOf(meme) + 1, 2)] ?? meme;
  if (intent === "shorter") length = lengths[Math.max(lengths.indexOf(length) - 1, 0)] ?? length;
  return {
    trashTalk: trash,
    profanity,
    adultHumor: base.adult_humor,
    memeLevel: meme,
    length,
  };
}

export async function restyleRecap(form: FormData) {
  const user = await requireUser();
  const leagueId = uuidSchema.safeParse(form.get("leagueId"));
  const week = z.coerce.number().int().min(1).max(22).safeParse(form.get("week"));
  const intent = z.enum(["again", "funnier", "meaner", "softer", "shorter"]).safeParse(form.get("intent"));
  if (!leagueId.success || !week.success || !intent.success) return;
  const client = await createClient();
  const recap = await client
    .from("weekly_recaps")
    .select("id,settings_snapshot")
    .eq("league_id", leagueId.data)
    .eq("week", week.data)
    .maybeSingle();
  const league = await client.from("leagues").select("commissioner_id").eq("id", leagueId.data).maybeSingle();
  if (!recap.data || league.data?.commissioner_id !== user.id) return;
  const settings = toneSchema.parse(recap.data.settings_snapshot);
  const [teams, matchups, usage] = await Promise.all([
    client.from("teams").select("id,name").eq("league_id", leagueId.data).eq("active", true),
    client.from("matchups").select("week,team_id,opponent_id,team_score,opponent_score,status,bench_points,bench_beat_starter,bench_would_flip").eq("league_id", leagueId.data),
    client.from("vocabulary_usage").select("vocabulary_id,family,week").eq("league_id", leagueId.data).lt("week", week.data),
  ]);
  if (teams.error || matchups.error) return;
  const names = new Map((teams.data ?? []).map((team) => [team.id, team.name]));
  const rows = (matchups.data ?? []).filter((row) => row.team_score !== null && row.opponent_score !== null);
  const current = rows
    .filter((row) => row.week === week.data && row.status === "final")
    .map((row) => ({
      teamId: row.team_id,
      name: names.get(row.team_id) ?? "Team",
      opponentId: row.opponent_id,
      opponentName: row.opponent_id ? (names.get(row.opponent_id) ?? "Opponent") : "a bye",
      points: Number(row.team_score),
      opponentPoints: Number(row.opponent_score),
      benchPoints: row.bench_points === null ? null : Number(row.bench_points),
      benchBeatStarter: row.bench_beat_starter,
      benchWouldFlip: row.bench_would_flip,
    }));
  if (current.length === 0) return;
  const prior = rows
    .filter((row) => row.week < week.data && row.status === "final")
    .map((row) => ({
      teamId: row.team_id,
      week: row.week,
      points: Number(row.team_score),
      opponentPoints: Number(row.opponent_score),
    }));
  const drafted = draftRecap(
    week.data,
    current,
    prior,
    shifted(settings, intent.data),
    (usage.data ?? []).map((row) => ({
      vocabularyId: row.vocabulary_id,
      family: row.family,
      week: row.week,
    })),
  );
  const saved = await client.rpc("replace_weekly_recap", {
    target: recap.data.id,
    new_body: drafted.body,
    sections: drafted.sections,
    resend: false,
  });
  if (saved.error) return;
  revalidatePath(`/leagues/${leagueId.data}/recaps/${week.data}`);
}

export async function saveRecapEdits(form: FormData) {
  await requireUser();
  const recapId = uuidSchema.safeParse(form.get("recapId"));
  const leagueId = uuidSchema.safeParse(form.get("leagueId"));
  const week = z.coerce.number().int().safeParse(form.get("week"));
  const body = z.string().trim().min(1).max(12000).safeParse(form.get("body"));
  if (!recapId.success || !leagueId.success || !week.success || !body.success) return;
  const client = await createClient();
  const saved = await client.rpc("replace_weekly_recap", {
    target: recapId.data,
    new_body: body.data,
    sections: null,
    resend: form.get("resend") === "on",
  });
  if (!saved.error) revalidatePath(`/leagues/${leagueId.data}/recaps/${week.data}`);
}
