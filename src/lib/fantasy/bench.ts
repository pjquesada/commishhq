/** Team-level bench facts. Player names are not required. */
export function benchSummary(
  starters: string[],
  points: Record<string, number>,
  teamPoints: number,
  opponentPoints: number | null,
) {
  const starterIds = new Set(starters);
  let starter = 0;
  let bench = 0;
  for (const [id, value] of Object.entries(points)) {
    if (starterIds.has(id)) starter += value;
    else bench += value;
  }
  const rounded = (value: number) => Math.round(value * 100) / 100;
  const lost = opponentPoints !== null && teamPoints < opponentPoints;
  const margin = opponentPoints === null ? null : Math.abs(opponentPoints - teamPoints);
  return {
    starterPoints: rounded(starter),
    benchPoints: rounded(bench),
    benchBeatStarter: bench > starter && starter > 0,
    benchWouldFlip: lost && margin !== null && bench > margin,
  };
}
