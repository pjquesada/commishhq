export const storyTags = [
  "HIGHEST_SCORE",
  "LOWEST_SCORE",
  "BLOWOUT_WIN",
  "BLOWOUT_LOSS",
  "CLOSE_WIN",
  "CLOSE_LOSS",
  "NAILBITER",
  "WIN_STREAK",
  "LOSS_STREAK",
  "UPSET",
  "BENCH_DISASTER",
  "BENCH_HEROICS",
  "BELOW_MEDIAN_WIN",
  "ABOVE_MEDIAN_LOSS",
  "SEASON_HIGH",
  "SEASON_LOW",
  "COMEBACK_SEASON",
  "COLLAPSE",
  "PLAYOFF_CLINCH",
  "PLAYOFF_ELIMINATION",
] as const;
export type StoryTag = (typeof storyTags)[number];

export interface PriorGame {
  teamId: string;
  week: number;
  points: number;
  opponentPoints: number;
}
export interface CurrentSide {
  teamId: string;
  name: string;
  opponentId: string | null;
  opponentName: string;
  points: number;
  opponentPoints: number;
  benchPoints?: number | null;
  benchBeatStarter?: boolean;
  benchWouldFlip?: boolean;
}
export interface TeamStory extends CurrentSide {
  tags: StoryTag[];
  streak: number;
  margin: number;
  won: boolean;
  lost: boolean;
}
export interface RecapFacts {
  week: number;
  teams: TeamStory[];
  playedTags: StoryTag[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function outcome(points: number, opponent: number): "W" | "L" | "T" {
  if (points > opponent) return "W";
  if (points < opponent) return "L";
  return "T";
}

export function detectStories(
  week: number,
  current: CurrentSide[],
  prior: PriorGame[],
  options?: { playoffSpots?: number; weeksRemaining?: number },
): RecapFacts {
  const scores = current.map((team) => team.points);
  const high = Math.max(...scores);
  const low = Math.min(...scores);
  const weekMedian = median(scores);
  const priorByTeam = new Map<string, PriorGame[]>();
  for (const game of prior) {
    priorByTeam.set(game.teamId, [...(priorByTeam.get(game.teamId) ?? []), game]);
  }
  const record = (teamId: string) => {
    const games = priorByTeam.get(teamId) ?? [];
    return {
      wins: games.filter((game) => game.points > game.opponentPoints).length,
      losses: games.filter((game) => game.points < game.opponentPoints).length,
    };
  };
  const teams: TeamStory[] = current.map((team) => {
    const tags: StoryTag[] = [];
    const won = team.points > team.opponentPoints;
    const lost = team.points < team.opponentPoints;
    const margin = Math.abs(team.points - team.opponentPoints);
    const history = [...(priorByTeam.get(team.teamId) ?? [])].sort((a, b) => b.week - a.week);
    const thisResult = outcome(team.points, team.opponentPoints);
    let streak = thisResult === "W" ? 1 : thisResult === "L" ? -1 : 0;
    if (thisResult !== "T") {
      for (const game of history) {
        const previous = outcome(game.points, game.opponentPoints);
        if (previous !== thisResult) break;
        streak += thisResult === "W" ? 1 : -1;
      }
    }
    const priorPoints = history.map((game) => game.points);
    if (priorPoints.length > 0 && team.points > Math.max(...priorPoints)) tags.push("SEASON_HIGH");
    if (priorPoints.length > 0 && team.points < Math.min(...priorPoints)) tags.push("SEASON_LOW");
    if (team.points === high) tags.push("HIGHEST_SCORE");
    if (team.points === low) tags.push("LOWEST_SCORE");
    if (won && margin >= 25) tags.push("BLOWOUT_WIN");
    if (lost && margin >= 25) tags.push("BLOWOUT_LOSS");
    if (won && margin > 0 && margin <= 3) tags.push("CLOSE_WIN");
    if (lost && margin > 0 && margin <= 3) tags.push("CLOSE_LOSS");
    if (margin > 0 && margin <= 1) tags.push("NAILBITER");
    if (streak >= 3) tags.push("WIN_STREAK");
    if (streak <= -3) tags.push("LOSS_STREAK");
    const mine = record(team.teamId);
    const theirs = team.opponentId ? record(team.opponentId) : { wins: 0, losses: 0 };
    if (won && mine.wins + 2 <= theirs.wins) tags.push("UPSET");
    if (won && team.points < weekMedian) tags.push("BELOW_MEDIAN_WIN");
    if (lost && team.points > weekMedian) tags.push("ABOVE_MEDIAN_LOSS");
    if (team.benchBeatStarter || team.benchWouldFlip) tags.push("BENCH_DISASTER");
    if ((team.benchPoints ?? 0) > team.points && won) tags.push("BENCH_HEROICS");
    if (won && mine.losses >= 3 && mine.losses >= mine.wins + 2) tags.push("COMEBACK_SEASON");
    const priorWinStreak = history.every(() => false)
      ? 0
      : (() => {
          let count = 0;
          for (const game of history) {
            if (game.points <= game.opponentPoints) break;
            count += 1;
          }
          return count;
        })();
    if (lost && priorWinStreak >= 3) tags.push("COLLAPSE");
    const weeksRemaining = options?.weeksRemaining;
    if (options?.playoffSpots && weeksRemaining !== undefined && options.playoffSpots > 0) {
      const winsNow = mine.wins + (won ? 1 : 0);
      const others = current
        .filter((other) => other.teamId !== team.teamId)
        .map((other) => record(other.teamId).wins + (other.points > other.opponentPoints ? 1 : 0));
      const bestOtherCeiling = Math.max(...others.map((wins) => wins + weeksRemaining));
      if (winsNow > bestOtherCeiling && options.playoffSpots >= 1) tags.push("PLAYOFF_CLINCH");
      const cutoff = [...others].sort((a, b) => b - a)[options.playoffSpots - 1] ?? 0;
      if (winsNow + weeksRemaining < cutoff) tags.push("PLAYOFF_ELIMINATION");
    }
    return { ...team, tags, streak, margin, won, lost };
  });
  const playedTags = [...new Set(teams.flatMap((team) => team.tags))];
  return { week, teams, playedTags };
}
