import { describe, expect, it } from "vitest";
import { standings as rankTeams, winningPercentage } from "@/lib/fantasy/standings";
import type { Team } from "@/lib/fantasy/types";

function team(
  externalId: string,
  wins: number,
  losses: number,
  ties: number,
  pointsFor: number,
): Team {
  return {
    id: externalId,
    leagueId: "league",
    externalId,
    name: `Team ${externalId}`,
    managers: [],
    wins,
    losses,
    ties,
    pointsFor,
    pointsAgainst: 0,
  };
}

describe("standings", () => {
  it("uses ties as half a win", () => {
    expect(winningPercentage(team("1", 1, 0, 1, 0))).toBe(0.75);
  });

  it("sorts by win percentage, points for, then stable provider team id", () => {
    const ranked = rankTeams([
      team("10", 2, 1, 0, 300),
      team("2", 2, 1, 0, 300),
      team("3", 2, 1, 0, 350),
      team("4", 3, 0, 0, 200),
    ]);
    expect(ranked.map((entry) => entry.externalId)).toEqual([
      "4",
      "3",
      "2",
      "10",
    ]);
  });

  it("does not mutate provider order", () => {
    const original = [team("2", 1, 1, 0, 10), team("1", 2, 0, 0, 20)];
    rankTeams(original);
    expect(original.map((entry) => entry.externalId)).toEqual(["2", "1"]);
  });
});
