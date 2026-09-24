import {
  leagueSchema,
  teamSchema,
  matchupSchema,
  type League,
  type Team,
  type Matchup,
} from "../../types";
import type {
  SleeperLeague,
  SleeperRoster,
  SleeperUser,
  SleeperState,
  SleeperMatchup,
} from "./schemas";
import { ProviderError } from "./client";
export function score(whole: number, hundredths = 0): number {
  return Math.round((whole + hundredths / 100) * 100) / 100;
}
export function activeWeek(
  league: SleeperLeague,
  state: SleeperState,
): number | null {
  // NFL playoff week numbers restart; never attach those to regular-season leagues.
  return league.season === state.season &&
    league.season_type === state.season_type &&
    state.week >= 1 &&
    state.week <= 22
    ? state.week
    : null;
}
export function mapLeague(raw: SleeperLeague, state: SleeperState): League {
  return leagueSchema.parse({
    id: raw.league_id,
    externalId: raw.league_id,
    name: raw.name,
    provider: "sleeper",
    season: Number(raw.season),
    currentWeek: activeWeek(raw, state),
  });
}
export function mapTeams(
  leagueId: string,
  rosters: SleeperRoster[],
  users: SleeperUser[],
): Team[] {
  if (
    new Set(rosters.map((r) => r.roster_id)).size !== rosters.length ||
    new Set(users.map((u) => u.user_id)).size !== users.length
  )
    throw new ProviderError("malformed");
  const byUser = new Map(users.map((user) => [user.user_id, user]));
  return rosters.map((roster) => {
    if (roster.league_id !== leagueId) throw new ProviderError("malformed");
    const owner = roster.owner_id ? byUser.get(roster.owner_id) : undefined;
    const owners = [
      ...new Set(
        [roster.owner_id, ...(roster.co_owners ?? [])].filter(
          (id): id is string => id !== null,
        ),
      ),
    ];
    if (owners.some((id) => !byUser.has(id)))
      throw new ProviderError("malformed");
    return teamSchema.parse({
      id: String(roster.roster_id),
      leagueId,
      externalId: String(roster.roster_id),
      name:
        owner?.metadata?.team_name?.trim() ||
        owner?.display_name?.trim() ||
        owner?.username?.trim() ||
        `Team ${roster.roster_id}`,
      managers: owners.map((id) => ({
        externalId: id,
        displayName:
          byUser.get(id)?.display_name?.trim() ||
          byUser.get(id)?.username?.trim() ||
          `Manager ${id}`,
      })),
      wins: roster.settings.wins,
      losses: roster.settings.losses,
      ties: roster.settings.ties,
      pointsFor: score(roster.settings.fpts, roster.settings.fpts_decimal),
      pointsAgainst: score(
        roster.settings.fpts_against,
        roster.settings.fpts_against_decimal,
      ),
    });
  });
}
export function mapMatchups(
  league: SleeperLeague,
  state: SleeperState,
  week: number,
  rows: SleeperMatchup[],
  teams: Team[],
): Matchup[] {
  const teamIds = new Set(teams.map((t) => t.externalId));
  if (
    new Set(rows.map((r) => r.roster_id)).size !== rows.length ||
    rows.some((row) => !teamIds.has(String(row.roster_id)))
  )
    throw new ProviderError("malformed");
  const groups = new Map<string, SleeperMatchup[]>();
  for (const row of rows) {
    const key =
      row.matchup_id === null ? `bye-${row.roster_id}` : String(row.matchup_id);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([id, group]) => {
    if (group.length > 2) throw new ProviderError("malformed");
    const final =
      league.status === "complete" ||
      week <= (league.settings.last_scored_leg ?? 0);
    const scheduled =
      ["pre_draft", "drafting"].includes(league.status) ||
      week > state.leg ||
      group.every((row) => row.points == null && row.custom_points == null);
    return matchupSchema.parse({
      id,
      leagueId: league.league_id,
      week,
      status: final ? "final" : scheduled ? "scheduled" : "live",
      scores: group.map((row) => ({
        teamId: String(row.roster_id),
        points: row.custom_points ?? row.points ?? null,
      })),
    });
  });
}
