import { z } from "zod";

export const providerIdSchema = z.enum(["sleeper", "yahoo", "espn"]);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const leagueStatusSchema = z.enum([
  "pre_draft",
  "drafting",
  "in_season",
  "complete",
]);
export type LeagueStatus = z.infer<typeof leagueStatusSchema>;

export const leagueSchema = z.object({
  id: z.string().min(1),
  provider: providerIdSchema,
  externalId: z.string().min(1),
  name: z.string().min(1),
  season: z.number().int().min(2000).max(2200),
  sport: z.literal("nfl"),
  status: leagueStatusSchema,
  totalTeams: z.number().int().nonnegative(),
  currentWeek: z.number().int().min(0).max(22).nullable(),
  timezone: z.string().min(1),
});
export type League = z.infer<typeof leagueSchema>;

export const leagueMemberSchema = z.object({
  id: z.string().min(1),
  leagueId: z.string().min(1),
  providerUserId: z.string().min(1),
  username: z.string().nullable(),
  displayName: z.string().min(1),
  avatar: z.string().nullable(),
  isProviderCommissioner: z.boolean(),
});
export type LeagueMember = z.infer<typeof leagueMemberSchema>;

export const teamSchema = z.object({
  id: z.string().min(1),
  leagueId: z.string().min(1),
  externalId: z.string().min(1),
  name: z.string().min(1),
  ownerExternalId: z.string().nullable(),
  avatar: z.string().nullable(),
  managers: z.array(
    z.object({ externalId: z.string().min(1), displayName: z.string().min(1) }),
  ),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  ties: z.number().int().nonnegative(),
  pointsFor: z.number().finite().nonnegative(),
  pointsAgainst: z.number().finite().nonnegative(),
});
export type Team = z.infer<typeof teamSchema>;

export const matchupSchema = z.object({
  id: z.string().min(1),
  leagueId: z.string().min(1),
  week: z.number().int().min(1).max(22),
  status: z.enum(["scheduled", "live", "final"]),
  scores: z
    .array(
      z.object({
        teamId: z.string().min(1),
        points: z.number().finite().nullable(),
      }),
    )
    .min(1),
});
export type Matchup = z.infer<typeof matchupSchema>;

export interface LeagueSettings {
  teamCount: number;
  scoring: "standard" | "half-ppr" | "ppr" | "custom";
  playoffStartWeek: number | null;
}

export interface Transaction {
  id: string;
  leagueId: string;
  type: "trade";
  teamIds: string[];
  occurredAt: string;
}

export interface ProviderCapabilities {
  matchups: boolean;
  standings: boolean;
  transactions: boolean;
  projections: boolean;
}
