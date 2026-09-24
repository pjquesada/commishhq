import { describe, expect, it, vi } from "vitest";
import {
  sleeperLeagueSchema,
  sleeperRosterSchema,
  sleeperUserSchema,
  sleeperStateSchema,
  sleeperMatchupSchema,
} from "@/lib/fantasy/providers/sleeper/schemas";
import {
  mapLeague,
  mapTeams,
  mapMatchups,
  score,
  activeWeek,
} from "@/lib/fantasy/providers/sleeper/mapper";
import { SleeperClient } from "@/lib/fantasy/providers/sleeper/client";
import { SleeperAdapter } from "@/lib/fantasy/providers/sleeper/adapter";
import { standings, winningPercentage } from "@/lib/fantasy/standings";
const league = sleeperLeagueSchema.parse({
  league_id: "1234567890123456789",
  name: "Test league",
  sport: "nfl",
  season: "2026",
  season_type: "regular",
  total_rosters: 2,
  status: "in_season",
  settings: { last_scored_leg: 6 },
  scoring_settings: { rec: 0.5 },
});
const state = sleeperStateSchema.parse({
  season: "2026",
  season_type: "regular",
  week: 7,
  leg: 7,
});
const users = [
  sleeperUserSchema.parse({
    user_id: "100",
    display_name: "Pablo",
    metadata: { team_name: "Fourth & Chaos" },
  }),
  sleeperUserSchema.parse({ user_id: "200", username: "Amanda" }),
];
const roster = (id: number, owner: string | null) =>
  sleeperRosterSchema.parse({
    roster_id: id,
    league_id: league.league_id,
    owner_id: owner,
    settings: {
      wins: 2,
      losses: 1,
      ties: 1,
      fpts: 143,
      fpts_decimal: 52,
      fpts_against: 121,
      fpts_against_decimal: 7,
    },
  });
const teams = mapTeams(
  league.league_id,
  [roster(1, "100"), roster(2, "200")],
  users,
);
describe("Sleeper response contracts", () => {
  it("keeps snowflake league IDs as exact strings", () =>
    expect(mapLeague(league, state).externalId).toBe("1234567890123456789"));
  it.each([
    { ...league, league_id: 1234 },
    { ...league, sport: "nba" },
    { ...league, season: "nope" },
    { ...league, name: null },
  ])("rejects malformed league %#", (bad) =>
    expect(sleeperLeagueSchema.safeParse(bad).success).toBe(false),
  );
  it("rejects invalid roster scores and IDs", () => {
    expect(
      sleeperRosterSchema.safeParse({ ...roster(1, "100"), roster_id: "1" })
        .success,
    ).toBe(false);
    expect(
      sleeperRosterSchema.safeParse({
        ...roster(1, "100"),
        settings: { ...roster(1, "100").settings, fpts_decimal: 123 },
      }).success,
    ).toBe(false);
  });
  it("validates provider managers and tolerates null metadata", () => {
    expect(sleeperUserSchema.safeParse({ display_name: "Fake" }).success).toBe(
      false,
    );
    expect(
      sleeperUserSchema.parse({ user_id: "1", metadata: null }).metadata,
    ).toBeNull();
  });
  it("converts decimal fields as hundredths", () => {
    expect(score(143, 52)).toBe(143.52);
    expect(score(143, 5)).toBe(143.05);
    expect(score(0, 99)).toBe(0.99);
    expect(score(143)).toBe(143);
    expect(teams[0]?.pointsAgainst).toBe(121.07);
  });
  it("maps custom team name, username fallback and vacant rosters", () => {
    expect(teams[0]?.name).toBe("Fourth & Chaos");
    expect(teams[1]?.name).toBe("Amanda");
    expect(
      mapTeams(league.league_id, [roster(3, null)], users)[0],
    ).toMatchObject({ name: "Team 3", managers: [] });
  });
  it("rejects wrong league and missing owner references", () => {
    expect(() => mapTeams("999", [roster(1, "100")], users)).toThrow();
    expect(() =>
      mapTeams(league.league_id, [roster(1, "999")], users),
    ).toThrow();
  });
  it("keeps co-managers separate from CommishHQ identity", () => {
    const result = mapTeams(
      league.league_id,
      [{ ...roster(1, "100"), co_owners: ["200"] }],
      users,
    );
    expect(result[0]?.managers.map((m) => m.externalId)).toEqual([
      "100",
      "200",
    ]);
    expect(result[0]).not.toHaveProperty("user_id");
  });
  it("does not attach another season or postseason week", () => {
    expect(activeWeek(league, state)).toBe(7);
    expect(activeWeek(league, { ...state, season: "2027" })).toBeNull();
    expect(activeWeek(league, { ...state, season_type: "post" })).toBeNull();
    expect(activeWeek(league, { ...state, week: 0 })).toBeNull();
  });
});
describe("matchup normalization", () => {
  const moreTeams = mapTeams(
    league.league_id,
    [roster(1, "100"), roster(2, "200"), roster(3, null), roster(4, null)],
    users,
  );
  it("groups by matchup ID, never array position", () => {
    const rows = [
      { roster_id: 1, matchup_id: 8, points: 123 },
      { roster_id: 3, matchup_id: 9, points: 55 },
      { roster_id: 2, matchup_id: 8, points: 90 },
      { roster_id: 4, matchup_id: 9, points: 80 },
    ];
    expect(
      mapMatchups(league, state, 7, rows, moreTeams).map((m) =>
        m.scores.map((s) => s.teamId),
      ),
    ).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });
  it("preserves unknown scores and zero custom overrides", () => {
    const rows = [
      sleeperMatchupSchema.parse({
        roster_id: 1,
        matchup_id: 1,
        points: 45,
        custom_points: 0,
      }),
      sleeperMatchupSchema.parse({ roster_id: 2, matchup_id: 1 }),
    ];
    expect(
      mapMatchups(league, state, 7, rows, teams)[0]?.scores.map(
        (s) => s.points,
      ),
    ).toEqual([0, null]);
  });
  it("does not pair unrelated null-matchup byes", () =>
    expect(
      mapMatchups(
        league,
        state,
        7,
        [
          { roster_id: 1, matchup_id: null },
          { roster_id: 2, matchup_id: null },
        ],
        teams,
      ),
    ).toHaveLength(2));
  it("represents scheduled, live and final states", () => {
    const rows = [
      { roster_id: 1, matchup_id: 1, points: 20 },
      { roster_id: 2, matchup_id: 1, points: 30 },
    ];
    expect(mapMatchups(league, state, 6, rows, teams)[0]?.status).toBe("final");
    expect(mapMatchups(league, state, 7, rows, teams)[0]?.status).toBe("live");
    expect(mapMatchups(league, state, 8, rows, teams)[0]?.status).toBe(
      "scheduled",
    );
  });
  it("rejects duplicate teams and unknown roster IDs", () => {
    expect(() =>
      mapMatchups(
        league,
        state,
        7,
        [
          { roster_id: 1, matchup_id: 1 },
          { roster_id: 1, matchup_id: 1 },
        ],
        teams,
      ),
    ).toThrow();
    expect(() =>
      mapMatchups(league, state, 7, [{ roster_id: 99, matchup_id: 1 }], teams),
    ).toThrow();
  });
});
describe("provider HTTP boundary", () => {
  it("rejects unsafe league paths without fetching", () => {
    const fetcher = vi.fn();
    expect(() => new SleeperClient("../state/nfl", fetcher)).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([404, 429, 503])(
    "reports HTTP %s instead of fake data",
    async (status) => {
      const client = new SleeperClient(
        "123",
        vi.fn().mockResolvedValue(new Response("{}", { status })),
      );
      await expect(client.league()).rejects.toMatchObject({
        code: status === 404 ? "not_found" : "unavailable",
      });
    },
  );
  it("handles null, malformed JSON and malformed schemas", async () => {
    for (const body of ["null", "not json", "{}"]) {
      const client = new SleeperClient(
        "123",
        vi.fn().mockResolvedValue(new Response(body)),
      );
      await expect(client.league()).rejects.toThrow();
    }
  });
  it("reports timeouts without retry storms", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new DOMException("deadline", "TimeoutError"));
    await expect(
      new SleeperClient("123", fetcher).state(),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("sets a timeout, disables cache and refuses redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(league));
    await new SleeperClient(league.league_id, fetcher).league();
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.sleeper.app/v1/league/${league.league_id}`,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        cache: "no-store",
        redirect: "error",
      }),
    );
  });
  it("adapter normalizes a complete snapshot with request-local deduplication", async () => {
    const payloads: Record<string, unknown> = {
      [`league/${league.league_id}`]: league,
      "state/nfl": state,
      [`league/${league.league_id}/users`]: users,
      [`league/${league.league_id}/rosters`]: [
        roster(1, "100"),
        roster(2, "200"),
      ],
      [`league/${league.league_id}/matchups/7`]: [
        { roster_id: 1, matchup_id: 1, points: 10 },
        { roster_id: 2, matchup_id: 1, points: 20 },
      ],
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      Response.json(
        payloads[String(input).replace("https://api.sleeper.app/v1/", "")],
      ),
    );
    const adapter = new SleeperAdapter(
      new SleeperClient(league.league_id, fetcher),
    );
    const [a, b, c, d] = await Promise.all([
      adapter.getLeague(),
      adapter.getTeams(),
      adapter.getMatchups(7),
      adapter.getManagers(),
    ]);
    expect(a.currentWeek).toBe(7);
    expect(b).toHaveLength(2);
    expect(c).toHaveLength(1);
    expect(d).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
});
describe("deterministic standings", () => {
  it("counts ties as half a win and handles no games", () => {
    expect(winningPercentage(teams[0]!)).toBe(0.625);
    expect(
      winningPercentage({ ...teams[0]!, wins: 0, losses: 0, ties: 0 }),
    ).toBe(0);
  });
  it("orders by percentage, points for, then stable roster ID without mutation", () => {
    const input = [
      { externalId: "10", wins: 1, losses: 1, ties: 0, pointsFor: 100 },
      { externalId: "2", wins: 1, losses: 1, ties: 0, pointsFor: 100 },
      { externalId: "3", wins: 1, losses: 1, ties: 0, pointsFor: 101 },
      { externalId: "1", wins: 2, losses: 0, ties: 0, pointsFor: 50 },
    ];
    const original = structuredClone(input);
    expect(standings(input).map((t) => t.externalId)).toEqual([
      "1",
      "3",
      "2",
      "10",
    ]);
    expect(input).toEqual(original);
  });
});
