import { z } from "zod";
export const providerIdSchema = z.enum(["sleeper", "yahoo", "espn"]);
export type ProviderId = z.infer<typeof providerIdSchema>;
export const providerManagerSchema = z.object({
  externalId: z.string().min(1),
  displayName: z.string().min(1).max(200),
});
export type ProviderManager = z.infer<typeof providerManagerSchema>;
export const leagueSchema = z.object({
  id: z.string().min(1),
  provider: providerIdSchema,
  externalId: z.string().min(1),
  name: z.string().min(1),
  season: z.number().int().min(2000).max(2200),
  currentWeek: z.number().int().min(0).max(22).nullable(),
  sport: z.literal('nfl').optional(),
  status: z.enum(['pre_draft','drafting','in_season','complete']).optional(),
  totalTeams: z.number().int().positive().optional(),
});
export type League = z.infer<typeof leagueSchema>;
export const teamSchema = z.object({
  id: z.string().min(1),
  leagueId: z.string().min(1),
  externalId: z.string().min(1),
  name: z.string().min(1),
  managers: z.array(
    z.object({ externalId: z.string().min(1), displayName: z.string().min(1) }),
  ),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  ties: z.number().int().nonnegative(),
  pointsFor: z.number().finite(),
  pointsAgainst: z.number().finite(),
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
