import { z } from "zod";
// Snowflakes remain opaque strings. Never Number()/parseInt() league or user IDs.
export const sleeperIdSchema = z
  .string()
  .trim()
  .regex(/^\d{1,30}$/, "Enter a Sleeper League ID (digits only).");
const season = z.string().regex(/^20\d{2}$/);
const count = z.number().int().nonnegative();
const hundredths = z.number().int().min(0).max(99);
export const sleeperLeagueSchema = z.object({
  league_id: sleeperIdSchema,
  name: z.string().trim().min(1).max(120),
  sport: z.literal("nfl"),
  season,
  season_type: z.enum(["regular", "post", "pre"]),
  total_rosters: z.number().int().min(1).max(100),
  status: z.enum(["pre_draft", "drafting", "in_season", "complete"]),
  settings: z.object({
    playoff_week_start: count.optional(),
    last_scored_leg: count.optional(),
  }),
  scoring_settings: z.object({ rec: z.number().finite().optional() }),
});
export const sleeperUserSchema = z.object({
  user_id: sleeperIdSchema,
  display_name: z.string().max(200).nullish(),
  username: z.string().max(200).nullish(),
  metadata: z.object({ team_name: z.string().max(120).nullish() }).nullish(),
});
export const sleeperRosterSchema = z.object({
  roster_id: z.number().int().positive(),
  league_id: sleeperIdSchema,
  owner_id: sleeperIdSchema.nullable(),
  co_owners: z.array(sleeperIdSchema).nullish(),
  settings: z.object({
    wins: count,
    losses: count,
    ties: count,
    fpts: z.number().int(),
    fpts_decimal: hundredths.optional(),
    fpts_against: z.number().int(),
    fpts_against_decimal: hundredths.optional(),
  }),
});
export const sleeperStateSchema = z.object({
  season,
  season_type: z.enum(["pre", "regular", "post", "off"]),
  week: z.number().int().min(0).max(30),
  leg: z.number().int().min(0).max(30),
});
export const sleeperMatchupSchema = z.object({
  roster_id: z.number().int().positive(),
  matchup_id: z.number().int().nonnegative().nullable(),
  points: z.number().finite().nullish(),
  custom_points: z.number().finite().nullish(),
});
export type SleeperLeague = z.infer<typeof sleeperLeagueSchema>;
export type SleeperUser = z.infer<typeof sleeperUserSchema>;
export type SleeperRoster = z.infer<typeof sleeperRosterSchema>;
export type SleeperState = z.infer<typeof sleeperStateSchema>;
export type SleeperMatchup = z.infer<typeof sleeperMatchupSchema>;
