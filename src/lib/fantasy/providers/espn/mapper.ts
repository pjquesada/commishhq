import { z } from "zod";
import { leagueSchema, matchupSchema, teamSchema, type League, type Matchup, type Team } from "../../types";

const espnLeagueSchema = z.object({
  id: z.number().int().positive(),
  seasonId: z.number().int(),
  scoringPeriodId: z.number().int().min(0).max(22).optional(),
  settings: z.object({
    name: z.string().min(1).max(120),
    size: z.number().int().positive().max(40).optional(),
  }),
  teams: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string().min(1).max(120).optional(),
      record: z
        .object({
          overall: z
            .object({
              wins: z.number().int().nonnegative().optional(),
              losses: z.number().int().nonnegative().optional(),
              ties: z.number().int().nonnegative().optional(),
              pointsFor: z.number().finite().optional(),
              pointsAgainst: z.number().finite().optional(),
            })
            .optional(),
        })
        .optional(),
    }),
  ),
  schedule: z
    .array(
      z.object({
        matchupPeriodId: z.number().int(),
        home: z.object({ teamId: z.number().int(), totalPoints: z.number().finite().optional() }).optional(),
        away: z.object({ teamId: z.number().int(), totalPoints: z.number().finite().optional() }).optional(),
      }),
    )
    .optional(),
});
export type EspnLeaguePayload = z.infer<typeof espnLeagueSchema>;

export function parseEspnLeague(payload: unknown): EspnLeaguePayload {
  const parsed = espnLeagueSchema.safeParse(payload);
  if (!parsed.success) throw new Error("malformed");
  return parsed.data;
}

export function mapEspnLeague(payload: EspnLeaguePayload): League {
  return leagueSchema.parse({
    id: String(payload.id),
    provider: "espn",
    externalId: String(payload.id),
    name: payload.settings.name,
    season: payload.seasonId,
    currentWeek: payload.scoringPeriodId ?? null,
    status: "in_season",
    totalTeams: payload.settings.size ?? payload.teams.length,
  });
}

export function mapEspnTeams(payload: EspnLeaguePayload): Team[] {
  return payload.teams.map((team) =>
    teamSchema.parse({
      id: String(team.id),
      leagueId: String(payload.id),
      externalId: String(team.id),
      name: team.name?.trim() || `Team ${team.id}`,
      managers: [],
      wins: team.record?.overall?.wins ?? 0,
      losses: team.record?.overall?.losses ?? 0,
      ties: team.record?.overall?.ties ?? 0,
      pointsFor: team.record?.overall?.pointsFor ?? 0,
      pointsAgainst: team.record?.overall?.pointsAgainst ?? 0,
    }),
  );
}

export function mapEspnMatchups(payload: EspnLeaguePayload, week: number): Matchup[] {
  return (payload.schedule ?? [])
    .filter((game) => game.matchupPeriodId === week && game.home && game.away)
    .map((game) =>
      matchupSchema.parse({
        id: `${week}:${game.home!.teamId}:${game.away!.teamId}`,
        leagueId: String(payload.id),
        week,
        status: game.home?.totalPoints == null || game.away?.totalPoints == null ? "live" : "final",
        scores: [
          { teamId: String(game.home!.teamId), points: game.home?.totalPoints ?? null },
          { teamId: String(game.away!.teamId), points: game.away?.totalPoints ?? null },
        ],
      }),
    );
}
