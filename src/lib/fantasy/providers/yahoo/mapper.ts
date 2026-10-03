import { leagueSchema, matchupSchema, teamSchema, type League, type Matchup, type Team } from "../../types";

export interface YahooLeagueCard {
  leagueKey: string;
  name: string;
  season: number;
  currentWeek: number | null;
  teamCount: number;
}

function nestedNumber(node: unknown, key: string): number | null {
  if (!node || typeof node !== "object") return null;
  if (!Array.isArray(node) && Object.hasOwn(node, key)) {
    const value = Number((node as Record<string, unknown>)[key]);
    if (Number.isFinite(value)) return value;
  }
  for (const child of Object.values(node)) {
    const found = nestedNumber(child, key);
    if (found !== null) return found;
  }
  return null;
}

function lists(node: unknown): unknown[] | null {
  if (Array.isArray(node)) return node;
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => /^\d+$/.test(key));
  if (keys.length < 2) return null;
  return keys.sort((a, b) => Number(a) - Number(b)).map((key) => record[key]);
}

function merge(node: unknown, into: Record<string, unknown>) {
  if (Array.isArray(node)) {
    for (const part of node) merge(part, into);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (/^\d+$/.test(key) || key === "team") merge(value, into);
    else into[key] = value;
  }
}

function teamKeyCount(node: unknown): number {
  return JSON.stringify(node).match(/"team_key"/g)?.length ?? 0;
}

export function collectLeagues(payload: unknown): YahooLeagueCard[] {
  const found = new Map<string, YahooLeagueCard>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.league_key === "string" && typeof record.name === "string") {
      const season = Number(record.season ?? new Date().getFullYear());
      if (/^[0-9]{2,6}\.l\.[0-9]{1,12}$/.test(record.league_key)) {
        found.set(record.league_key, {
          leagueKey: record.league_key,
          name: record.name,
          season: Number.isFinite(season) ? season : new Date().getFullYear(),
          currentWeek: record.current_week == null ? null : Number(record.current_week),
          teamCount: Number(record.num_teams ?? 0),
        });
      }
    }
    const list = lists(node);
    if (list) list.forEach(walk);
    else Object.values(record).forEach(walk);
  };
  walk(payload);
  return [...found.values()];
}

export function collectTeams(leagueKey: string, payload: unknown): Team[] {
  const teams: Team[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node) && teamKeyCount(node) === 1) {
      const merged: Record<string, unknown> = {};
      merge(node, merged);
      const teamKey = merged.team_key;
      if (typeof teamKey === "string" && teamKey.startsWith(`${leagueKey}.t.`) && !seen.has(teamKey)) {
        seen.add(teamKey);
        const points = merged.team_points as { total?: string } | undefined;
        teams.push(
          teamSchema.parse({
            id: teamKey,
            leagueId: leagueKey,
            externalId: teamKey,
            name: typeof merged.name === "string" ? merged.name : "Team",
            managers: [],
            wins: nestedNumber(merged, "wins") ?? 0,
            losses: nestedNumber(merged, "losses") ?? 0,
            ties: nestedNumber(merged, "ties") ?? 0,
            pointsFor: Number(points?.total ?? 0),
            pointsAgainst: nestedNumber(merged, "points_against") ?? 0,
          }),
        );
      }
      return;
    }
    const list = lists(node);
    if (list) list.forEach(walk);
    else Object.values(node).forEach(walk);
  };
  walk(payload);
  return teams;
}

export function collectMatchups(leagueKey: string, week: number, payload: unknown): Matchup[] {
  const games: Matchup[] = [];
  const walk = (node: unknown) => {
    const list = lists(node);
    if (!list) {
      if (node && typeof node === "object") Object.values(node).forEach(walk);
      return;
    }
    const teams = list
      .map((part) => {
        const merged: Record<string, unknown> = {};
        merge(part, merged);
        return merged;
      })
      .filter((part) => typeof part.team_key === "string" && String(part.team_key).startsWith(leagueKey));
    if (teams.length === 2 && teamKeyCount(node) === 2) {
      const scores = teams.map((team) => {
        const points = team.team_points as { total?: string } | undefined;
        return { teamId: String(team.team_key), points: points?.total == null ? null : Number(points.total) };
      });
      games.push(
        matchupSchema.parse({
          id: `${week}:${scores.map((score) => score.teamId).sort().join(":")}`,
          leagueId: leagueKey,
          week,
          status: scores.every((score) => score.points !== null) ? "final" : "live",
          scores,
        }),
      );
    }
    list.forEach(walk);
  };
  walk(payload);
  return [...new Map(games.map((game) => [game.id, game])).values()];
}

export function toLeague(card: YahooLeagueCard): League {
  return leagueSchema.parse({
    id: card.leagueKey,
    provider: "yahoo",
    externalId: card.leagueKey,
    name: card.name,
    season: card.season,
    currentWeek: card.currentWeek,
    status: "in_season",
    totalTeams: card.teamCount,
  });
}
