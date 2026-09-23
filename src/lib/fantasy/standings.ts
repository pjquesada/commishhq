import type { Team } from "./types";

export function winningPercentage(team: Pick<Team, "wins" | "losses" | "ties">) {
  const games = team.wins + team.losses + team.ties;
  return games === 0 ? 0 : (team.wins + team.ties * 0.5) / games;
}

export function rankTeams(teams: Team[]) {
  return [...teams].sort((a, b) => {
    const winPct = winningPercentage(b) - winningPercentage(a);
    if (winPct !== 0) return winPct;
    const points = b.pointsFor - a.pointsFor;
    if (points !== 0) return points;
    return a.externalId.localeCompare(b.externalId, undefined, { numeric: true });
  });
}
