import { z } from "zod";

const looseRecord = z.record(z.string(), z.unknown());

export const sleeperLeagueSchema = z
  .object({
    league_id: z.string().min(1),
    name: z.string().min(1),
    season: z.string().regex(/^\d{4}$/),
    sport: z.literal("nfl"),
    status: z.enum(["pre_draft", "drafting", "in_season", "complete"]),
    total_rosters: z.number().int().nonnegative(),
    settings: looseRecord.default({}),
    scoring_settings: looseRecord.default({}),
  })
  .passthrough();

export const sleeperLeagueUserSchema = z
  .object({
    user_id: z.string().min(1),
    username: z.string().min(1).nullable().optional(),
    display_name: z.string().min(1),
    avatar: z.string().nullable().optional(),
    metadata: looseRecord.nullable().optional(),
    is_owner: z.boolean().nullable().optional(),
  })
  .passthrough();

export const sleeperRosterSchema = z
  .object({
    roster_id: z.number().int().positive(),
    owner_id: z.string().min(1).nullable().optional(),
    co_owners: z.array(z.string().min(1)).nullable().optional(),
    league_id: z.string().min(1),
    settings: z
      .object({
        wins: z.number().int().nonnegative().optional(),
        losses: z.number().int().nonnegative().optional(),
        ties: z.number().int().nonnegative().optional(),
        fpts: z.number().finite().optional(),
        fpts_decimal: z.number().int().optional(),
        fpts_against: z.number().finite().optional(),
        fpts_against_decimal: z.number().int().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const sleeperMatchupSchema = z
  .object({
    roster_id: z.number().int().positive(),
    matchup_id: z.number().int().positive().nullable(),
    points: z.number().finite().nullable().optional(),
    custom_points: z.number().finite().nullable().optional(),
  })
  .passthrough();

export const sleeperNflStateSchema = z
  .object({
    week: z.number().int().min(0).max(30),
    season_type: z.enum(["pre", "regular", "post"]),
    season: z.string().regex(/^\d{4}$/),
    league_season: z.string().regex(/^\d{4}$/).optional(),
    display_week: z.number().int().min(0).max(30).optional(),
  })
  .passthrough();

export const sleeperUsersSchema = z.array(sleeperLeagueUserSchema);
export const sleeperRostersSchema = z.array(sleeperRosterSchema);
export const sleeperMatchupsSchema = z.array(sleeperMatchupSchema);

export type SleeperLeague = z.infer<typeof sleeperLeagueSchema>;
export type SleeperLeagueUser = z.infer<typeof sleeperLeagueUserSchema>;
export type SleeperRoster = z.infer<typeof sleeperRosterSchema>;
export type SleeperMatchup = z.infer<typeof sleeperMatchupSchema>;
export type SleeperNflState = z.infer<typeof sleeperNflStateSchema>;
