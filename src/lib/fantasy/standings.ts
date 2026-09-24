export type Standing = {
  externalId: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
};
export function winningPercentage(team: Standing): number {
  const games = team.wins + team.losses + team.ties;
  return games === 0 ? 0 : (team.wins + team.ties / 2) / games;
}
function stableId(a: string, b: string): number {
  // Numeric-looking roster IDs sort naturally without precision loss; other IDs sort lexically.
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const aa = BigInt(a);
    const bb = BigInt(b);
    if (aa !== bb) return aa < bb ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
export function standings<T extends Standing>(
  teams: readonly T[],
): (T & { rank: number })[] {
  return [...teams]
    .sort(
      (a, b) =>
        winningPercentage(b) - winningPercentage(a) ||
        b.pointsFor - a.pointsFor ||
        stableId(a.externalId, b.externalId),
    )
    .map((team, index) => ({ ...team, rank: index + 1 }));
}
