import type {
  League,
  LeagueMember,
  LeagueSettings,
  Matchup,
  Team,
} from "../../types";
import type {
  SleeperLeague,
  SleeperLeagueUser,
  SleeperMatchup,
  SleeperNflState,
  SleeperRoster,
} from "./schemas";

const DEFAULT_TIMEZONE = "America/New_York";

function leagueKey(leagueId: string) {
  return `sleeper:${leagueId}`;
}

function teamKey(leagueId: string, rosterId: number) {
  return `${leagueKey(leagueId)}:roster:${rosterId}`;
}

function stringMetadata(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function combineSleeperPoints(
  whole: number | undefined,
  decimal: number | undefined,
) {
  return (whole ?? 0) + (decimal ?? 0) / 100;
}

export function mapSleeperLeague(
  league: SleeperLeague,
  state: SleeperNflState,
): League {
  const activeSeason =
    state.season === league.season || state.league_season === league.season;
  return {
    id: leagueKey(league.league_id),
    provider: "sleeper",
    externalId: league.league_id,
    name: league.name,
    season: Number(league.season),
    sport: "nfl",
    status: league.status,
    totalTeams: league.total_rosters,
    currentWeek: activeSeason ? Math.min(state.week, 22) : null,
    timezone: DEFAULT_TIMEZONE,
  };
}

export function mapSleeperMembers(
  leagueId: string,
  users: SleeperLeagueUser[],
): LeagueMember[] {
  return users.map((user) => ({
    id: `${leagueKey(leagueId)}:user:${user.user_id}`,
    leagueId: leagueKey(leagueId),
    providerUserId: user.user_id,
    username: user.username ?? null,
    displayName: user.display_name,
    avatar: user.avatar ?? null,
    isProviderCommissioner: user.is_owner === true,
  }));
}

export function mapSleeperTeams(
  leagueId: string,
  users: SleeperLeagueUser[],
  rosters: SleeperRoster[],
): Team[] {
  const usersById = new Map(users.map((user) => [user.user_id, user]));

  return rosters.map((roster) => {
    const managerIds = [
      ...(roster.owner_id ? [roster.owner_id] : []),
      ...(roster.co_owners ?? []),
    ];
    const managers = managerIds.flatMap((id) => {
      const user = usersById.get(id);
      return user
        ? [{ externalId: id, displayName: user.display_name }]
        : [];
    });
    const owner = roster.owner_id ? usersById.get(roster.owner_id) : undefined;
    const teamName =
      stringMetadata(owner?.metadata, "team_name") ??
      owner?.display_name ??
      owner?.username ??
      `Roster ${roster.roster_id}`;

    return {
      id: teamKey(leagueId, roster.roster_id),
      leagueId: leagueKey(leagueId),
      externalId: String(roster.roster_id),
      name: teamName,
      ownerExternalId: roster.owner_id ?? null,
      avatar: owner?.avatar ?? null,
      managers,
      wins: roster.settings.wins ?? 0,
      losses: roster.settings.losses ?? 0,
      ties: roster.settings.ties ?? 0,
      pointsFor: combineSleeperPoints(
        roster.settings.fpts,
        roster.settings.fpts_decimal,
      ),
      pointsAgainst: combineSleeperPoints(
        roster.settings.fpts_against,
        roster.settings.fpts_against_decimal,
      ),
    };
  });
}

function matchupStatus(
  week: number,
  currentWeek: number | null,
  leagueStatus: SleeperLeague["status"],
): Matchup["status"] {
  if (leagueStatus === "complete") return "final";
  if (currentWeek === null || week > currentWeek) return "scheduled";
  if (week < currentWeek) return "final";
  return "live";
}

export function mapSleeperMatchups(
  leagueId: string,
  week: number,
  rows: SleeperMatchup[],
  currentWeek: number | null,
  leagueStatus: SleeperLeague["status"],
): Matchup[] {
  const groups = new Map<string, SleeperMatchup[]>();

  for (const row of rows) {
    const key =
      row.matchup_id === null
        ? `bye-${row.roster_id}`
        : String(row.matchup_id);
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }

  return [...groups.entries()].map(([externalId, group]) => ({
    id: `${leagueKey(leagueId)}:week:${week}:matchup:${externalId}`,
    leagueId: leagueKey(leagueId),
    week,
    status: matchupStatus(week, currentWeek, leagueStatus),
    scores: group.map((row) => ({
      teamId: teamKey(leagueId, row.roster_id),
      points:
        typeof row.custom_points === "number"
          ? row.custom_points
          : (row.points ?? null),
    })),
  }));
}

export function mapSleeperLeagueSettings(
  league: SleeperLeague,
): LeagueSettings {
  const reception = league.scoring_settings.rec;
  let scoring: LeagueSettings["scoring"] = "custom";
  if (reception === 0) scoring = "standard";
  else if (reception === 0.5) scoring = "half-ppr";
  else if (reception === 1) scoring = "ppr";

  const playoffWeek = league.settings.playoff_week_start;
  return {
    teamCount: league.total_rosters,
    scoring,
    playoffStartWeek:
      typeof playoffWeek === "number" && Number.isInteger(playoffWeek)
        ? playoffWeek
        : null,
  };
}
