import "server-only";
import { z } from "zod";
import { createAdminClient, adminConfigured } from "@/lib/supabase/admin";
import { sleeperProvider } from "@/lib/fantasy/providers/sleeper";
import { isTimeZone } from "@/lib/time";
import { draftRecap } from "./draft";
import { maybePolish } from "./polish";
import { recapWindowOpen, weekIsFinal } from "./schedule";
import type { ToneSettings, VocabUse } from "./vocabulary";

const ENGINE = "1";
const settingsSchema = z.object({
  trash_talk: z.enum(["light", "normal", "savage"]),
  profanity: z.enum(["clean", "some", "uncensored"]),
  adult_humor: z.boolean(),
  meme_level: z.enum(["low", "medium", "brainrot"]),
  recap_length: z.enum(["quick", "normal", "full"]),
});
const sourceSchema = z.object({
  season: z.number(),
  timezone: z.string(),
  settings: settingsSchema,
  teams: z.array(z.object({ id: z.uuid(), name: z.string() })),
  matchups: z.array(
    z.object({
      week: z.number(),
      team_id: z.uuid(),
      opponent_id: z.uuid().nullable(),
      team_score: z.coerce.number().nullable(),
      opponent_score: z.coerce.number().nullable(),
      status: z.enum(["scheduled", "live", "final"]),
      bench_points: z.coerce.number().nullable(),
      bench_beat_starter: z.boolean(),
      bench_would_flip: z.boolean(),
    }),
  ),
  usage: z.array(z.object({ vocabulary_id: z.string(), family: z.string(), week: z.number() })),
});
const candidateSchema = z.array(
  z.object({
    league_id: z.uuid(),
    season: z.number(),
    timezone: z.string(),
    current_week: z.number(),
    week: z.number(),
    provider: z.enum(["sleeper", "yahoo", "espn"]),
    external_id: z.string(),
  }),
);

function tone(settings: z.infer<typeof settingsSchema>): ToneSettings {
  return {
    trashTalk: settings.trash_talk,
    profanity: settings.profanity,
    adultHumor: settings.adult_humor,
    memeLevel: settings.meme_level,
    length: settings.recap_length,
  };
}

async function sourceHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function generateDueRecaps(limit = 1, now = new Date()) {
  if (!adminConfigured()) return { generated: 0 };
  const admin = createAdminClient();
  const listed = await admin.rpc("due_recap_candidates", { batch: 8 });
  const candidates = candidateSchema.safeParse(listed.data ?? []);
  if (!candidates.success) return { generated: 0 };
  let generated = 0;
  for (const candidate of candidates.data) {
    if (generated >= limit) break;
    if (!isTimeZone(candidate.timezone) || !recapWindowOpen(now, candidate.timezone)) continue;
    let loaded = sourceSchema.safeParse(
      (await admin.rpc("recap_source", { target: candidate.league_id, wk: candidate.week })).data,
    );
    if (!loaded.success) continue;
    if (
      !weekIsFinal(loaded.data.teams, loaded.data.matchups, candidate.week) &&
      candidate.provider === "sleeper"
    ) {
      try {
        const games = await sleeperProvider(candidate.external_id).getMatchups(candidate.week);
        const saved = await admin.rpc("upsert_matchup_week", {
          target: candidate.league_id,
          wk: candidate.week,
          matchups: games,
        });
        if (saved.error) continue;
        loaded = sourceSchema.safeParse(
          (await admin.rpc("recap_source", { target: candidate.league_id, wk: candidate.week })).data,
        );
      } catch {
        continue;
      }
    }
    if (!loaded.success || !weekIsFinal(loaded.data.teams, loaded.data.matchups, candidate.week)) continue;
    const names = new Map(loaded.data.teams.map((team) => [team.id, team.name]));
    const rows = loaded.data.matchups.filter(
      (row) => row.week === candidate.week && row.team_score !== null && row.opponent_score !== null,
    );
    const current = rows.map((row) => ({
      teamId: row.team_id,
      name: names.get(row.team_id) ?? "Team",
      opponentId: row.opponent_id,
      opponentName: row.opponent_id ? (names.get(row.opponent_id) ?? "Opponent") : "a bye",
      points: row.team_score ?? 0,
      opponentPoints: row.opponent_score ?? 0,
      benchPoints: row.bench_points,
      benchBeatStarter: row.bench_beat_starter,
      benchWouldFlip: row.bench_would_flip,
    }));
    const prior = loaded.data.matchups
      .filter((row) => row.week < candidate.week && row.status === "final" && row.team_score !== null && row.opponent_score !== null)
      .map((row) => ({
        teamId: row.team_id,
        week: row.week,
        points: row.team_score ?? 0,
        opponentPoints: row.opponent_score ?? 0,
      }));
    const usage: VocabUse[] = loaded.data.usage.map((row) => ({
      vocabularyId: row.vocabulary_id,
      family: row.family,
      week: row.week,
    }));
    const drafted = draftRecap(candidate.week, current, prior, tone(loaded.data.settings), usage);
    const body = await maybePolish(drafted.body, drafted.facts, tone(loaded.data.settings));
    const hash = await sourceHash({ week: candidate.week, facts: drafted.facts, settings: loaded.data.settings });
    const published = await admin.rpc("publish_weekly_recap", {
      target: candidate.league_id,
      season_year: candidate.season,
      wk: candidate.week,
      payload: {
        engine_version: ENGINE,
        settings: loaded.data.settings,
        facts: drafted.facts,
        body,
        source_hash: hash,
        sections: drafted.sections,
        vocabulary: drafted.vocabulary,
      },
    });
    if (!published.error) generated += 1;
  }
  return { generated };
}
