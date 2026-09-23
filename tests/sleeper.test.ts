import { describe, expect, it } from "vitest";
import {
  sleeperLeagueSchema,
  sleeperMatchupsSchema,
  sleeperNflStateSchema,
  sleeperRostersSchema,
  sleeperUsersSchema,
} from "@/lib/fantasy/providers/sleeper/schemas";
import {
  combineSleeperPoints,
  mapSleeperLeague,
  mapSleeperMatchups,
  mapSleeperTeams,
} from "@/lib/fantasy/providers/sleeper/mapper";

const league = {
  league_id: "1397672371120267264",
  name: "Test League",
  season: "2026",
  sport: "nfl" as const,
  status: "in_season" as const,
  total_rosters: 2,
  settings: { playoff_week_start: 15 },
  scoring_settings: { rec: 1 },
};

const users = [
  {
    user_id: "u1",
    username: "alpha",
    display_name: "Alpha",
    avatar: "avatar1",
    metadata: { team_name: "Alpha Dogs" },
    is_owner: true,
  },
  {
    user_id: "u2",
    username: "beta",
    display_name: "Beta",
    avatar: null,
    metadata: null,
    is_owner: false,
  },
];

const rosters = [
  {
    roster_id: 1,
    owner_id: "u1",
    league_id: league.league_id,
    settings: {
      wins: 2,
      losses: 1,
      ties: 0,
      fpts: 321,
      fpts_decimal: 45,
      fpts_against: 300,
      fpts_against_decimal: 7,
    },
  },
  {
    roster_id: 2,
    owner_id: "u2",
    league_id: league.league_id,
    settings: {
      wins: 1,
      losses: 2,
      ties: 0,
      fpts: 300,
      fpts_decimal: 5,
      fpts_against: 321,
      fpts_against_decimal: 45,
    },
  },
];

describe("Sleeper response validation", () => {
  it("accepts the Phase 2 provider shapes", () => {
    expect(sleeperLeagueSchema.safeParse(league).success).toBe(true);
    expect(sleeperUsersSchema.safeParse(users).success).toBe(true);
    expect(sleeperRostersSchema.safeParse(rosters).success).toBe(true);
    expect(
      sleeperMatchupsSchema.safeParse([
        { roster_id: 1, matchup_id: 7, points: 101.2, custom_points: null },
      ]).success,
    ).toBe(true);
    expect(
      sleeperNflStateSchema.safeParse({
        week: 4,
        season_type: "regular",
        season: "2026",
        league_season: "2026",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed provider data instead of guessing", () => {
    expect(
      sleeperLeagueSchema.safeParse({ ...league, season: "twenty-six" }).success,
    ).toBe(false);
    expect(
      sleeperRostersSchema.safeParse([{ roster_id: "1" }]).success,
    ).toBe(false);
  });
});

describe("Sleeper normalization", () => {
  it("combines Sleeper integer and decimal point fields correctly", () => {
    expect(combineSleeperPoints(143, 52)).toBe(143.52);
    expect(combineSleeperPoints(143, 5)).toBe(143.05);
  });

  it("maps team names, standings, owners and points", () => {
    const teams = mapSleeperTeams(league.league_id, users, rosters);
    expect(teams[0]).toMatchObject({
      name: "Alpha Dogs",
      ownerExternalId: "u1",
      wins: 2,
      losses: 1,
      pointsFor: 321.45,
      pointsAgainst: 300.07,
    });
    expect(teams[1]?.name).toBe("Beta");
  });

  it("only uses the NFL week when the league season is active", () => {
    expect(
      mapSleeperLeague(league, {
        week: 4,
        season_type: "regular",
        season: "2026",
        league_season: "2026",
      }).currentWeek,
    ).toBe(4);
    expect(
      mapSleeperLeague(league, {
        week: 4,
        season_type: "regular",
        season: "2027",
        league_season: "2027",
      }).currentWeek,
    ).toBe(null);
  });

  it("pairs matchup rows by matchup_id rather than array order", () => {
    const mapped = mapSleeperMatchups(
      league.league_id,
      4,
      [
        { roster_id: 2, matchup_id: 9, points: 99.2 },
        { roster_id: 1, matchup_id: 8, points: 110.1 },
        { roster_id: 1, matchup_id: 9, points: 102.4 },
        { roster_id: 2, matchup_id: 8, points: 88.3 },
      ],
      4,
      "in_season",
    );
    expect(mapped).toHaveLength(2);
    expect(mapped.map((matchup) => matchup.scores.map((score) => score.points))).toEqual(
      [
        [99.2, 102.4],
        [110.1, 88.3],
      ],
    );
  });
});
