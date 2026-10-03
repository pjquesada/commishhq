import { describe, expect, it, vi } from "vitest";
import { EspnClient, espnExperimentalEnabled, redactEspn } from "../src/lib/fantasy/providers/espn/client";
import { mapEspnLeague, mapEspnMatchups, mapEspnTeams, parseEspnLeague } from "../src/lib/fantasy/providers/espn/mapper";

const payload = {
  id: 12345,
  seasonId: 2026,
  scoringPeriodId: 7,
  settings: { name: "Office League", size: 2 },
  teams: [
    {
      id: 1,
      name: "Alpha",
      record: { overall: { wins: 4, losses: 2, ties: 0, pointsFor: 140.5, pointsAgainst: 110 } },
    },
    { id: 2, name: "Bravo", record: { overall: { wins: 2, losses: 4, ties: 0, pointsFor: 110, pointsAgainst: 140.5 } } },
  ],
  schedule: [
    {
      matchupPeriodId: 7,
      home: { teamId: 1, totalPoints: 140.5 },
      away: { teamId: 2, totalPoints: 110.25 },
    },
  ],
};

describe("ESPN provider", () => {
  it("maps a public league into the shared models and rejects an unknown shape", () => {
    const parsed = parseEspnLeague(payload);
    expect(mapEspnLeague(parsed).externalId).toBe("12345");
    expect(mapEspnTeams(parsed).map((team) => team.name)).toEqual(["Alpha", "Bravo"]);
    expect(mapEspnMatchups(parsed, 7)[0]?.scores.map((score) => score.points)).toEqual([140.5, 110.25]);
    expect(() => parseEspnLeague({ id: "nope" })).toThrow(/malformed/);
  });

  it("keeps experimental private access off unless the flag is exactly true", async () => {
    delete process.env.ENABLE_ESPN_EXPERIMENTAL;
    expect(espnExperimentalEnabled()).toBe(false);
    const fetcher = vi.fn();
    const client = new EspnClient("12345", 2026, fetcher, { espnS2: "secret-cookie", swid: "{ABC}" });
    await expect(client.league()).rejects.toThrow(/turned off/);
    expect(fetcher).not.toHaveBeenCalled();
    process.env.ENABLE_ESPN_EXPERIMENTAL = "false";
    expect(espnExperimentalEnabled()).toBe(false);
  });

  it("redacts session cookies and does not echo ESPN error bodies", async () => {
    expect(redactEspn("cookie espn_s2=abc SWID={secret}")).not.toContain("abc");
    const client = new EspnClient("12345", 2026, async () => new Response("espn_s2=abc", { status: 401 }));
    await expect(client.league()).rejects.toThrow(/did not accept/);
    await expect(client.league()).rejects.not.toThrow(/abc/);
    const missing = new EspnClient("12345", 2026, async () => new Response("missing", { status: 404 }));
    await expect(missing.league()).rejects.toThrow(/not found/);
  });
});
