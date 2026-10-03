import { describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "../src/lib/crypto/tokens";
import { YahooClient } from "../src/lib/fantasy/providers/yahoo/client";
import { collectLeagues, collectMatchups, collectTeams } from "../src/lib/fantasy/providers/yahoo/mapper";
import { exchangeCode, refreshAccessToken, statesMatch } from "../src/lib/fantasy/providers/yahoo/oauth";

const leagueKey = "461.l.12345";
const leaguesPayload = {
  fantasy_content: {
    users: {
      "0": {
        user: [
          {
            games: {
              "0": {
                game: [
                  {
                    leagues: {
                      "0": {
                        league: [
                          {
                            league_key: leagueKey,
                            name: "Office League",
                            season: "2026",
                            num_teams: 2,
                            current_week: "7",
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  },
};
const standingsPayload = {
  fantasy_content: {
    league: [
      {
        standings: [
          {
            teams: {
              "0": {
                team: [
                  [{ team_key: `${leagueKey}.t.1` }, { name: "Alpha" }],
                  { team_points: { total: "140.50" } },
                  { team_standings: { outcome_totals: { wins: "4", losses: "2", ties: "0" } } },
                ],
              },
              "1": {
                team: [
                  [{ team_key: `${leagueKey}.t.2` }, { name: "Bravo" }],
                  { team_points: { total: "110.00" } },
                  { team_standings: { outcome_totals: { wins: "2", losses: "4", ties: "0" } } },
                ],
              },
            },
          },
        ],
      },
    ],
  },
};
const scoreboardPayload = {
  fantasy_content: {
    league: [
      {
        scoreboard: {
          "0": {
            matchups: {
              "0": {
                matchup: {
                  teams: {
                    "0": {
                      team: [
                        [{ team_key: `${leagueKey}.t.1` }],
                        { team_points: { total: "140.50" } },
                      ],
                    },
                    "1": {
                      team: [
                        [{ team_key: `${leagueKey}.t.2` }],
                        { team_points: { total: "110.25" } },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
  },
};

function key(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

describe("Yahoo Fantasy", () => {
  it("seals refresh tokens so the plaintext is not recoverable from the stored fields", async () => {
    const secretKey = key();
    const sealed = await encryptSecret("refresh-token-value", secretKey);
    expect(sealed.ciphertext).not.toContain("refresh-token-value");
    expect(JSON.stringify(sealed)).not.toContain(secretKey);
    await expect(decryptSecret(sealed, secretKey)).resolves.toBe("refresh-token-value");
    await expect(decryptSecret(sealed, key())).rejects.toThrow();
  });

  it("rejects a mismatched or short OAuth state", () => {
    expect(statesMatch("abcdefghijklmnop", "abcdefghijklmnop")).toBe(true);
    expect(statesMatch("abcdefghijklmnop", "abcdefghijklmnox")).toBe(false);
    expect(statesMatch("short", "short")).toBe(false);
  });

  it("exchanges and refreshes tokens without putting them in the error text", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.login.yahoo.com/oauth2/get_token");
      const body = String(init?.body);
      expect(body).not.toContain("client_secret");
      expect(String(init?.headers && new Headers(init.headers).get("authorization"))).toContain("Basic ");
      return new Response(
        JSON.stringify({ access_token: "access", refresh_token: "rotated", expires_in: 3600 }),
        { status: 200 },
      );
    });
    process.env.YAHOO_CLIENT_ID = "client";
    process.env.YAHOO_CLIENT_SECRET = "secret";
    process.env.YAHOO_REDIRECT_URI = "https://app.example/api/yahoo/callback";
    const exchanged = await exchangeCode("auth-code", fetcher);
    expect(exchanged.refresh_token).toBe("rotated");
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).toContain("code=auth-code");
    const refreshed = await refreshAccessToken("old-refresh", fetcher);
    expect(refreshed.access_token).toBe("access");
    fetcher.mockResolvedValueOnce(new Response("no", { status: 401 }));
    await expect(refreshAccessToken("old-refresh", fetcher)).rejects.toThrow(
      /token exchange failed/i,
    );
  });

  it("maps leagues, standings, and scoreboard matchups into the shared models", async () => {
    expect(collectLeagues(leaguesPayload)[0]).toMatchObject({
      leagueKey,
      name: "Office League",
      season: 2026,
      currentWeek: 7,
    });
    const teams = collectTeams(leagueKey, standingsPayload);
    expect(teams.map((team) => [team.name, team.wins, team.pointsFor])).toEqual([
      ["Alpha", 4, 140.5],
      ["Bravo", 2, 110],
    ]);
    const games = collectMatchups(leagueKey, 7, scoreboardPayload);
    expect(games).toHaveLength(1);
    expect(games[0]?.scores.map((score) => score.points).sort()).toEqual([110.25, 140.5]);
    const client = new YahooClient("token", async (url) => {
      expect(String(url)).toContain("fantasysports.yahooapis.com");
      expect(String(url)).toContain("format=json");
      if (String(url).includes("scoreboard")) return new Response(JSON.stringify(scoreboardPayload));
      if (String(url).includes("standings")) return new Response(JSON.stringify(standingsPayload));
      return new Response(JSON.stringify(leaguesPayload));
    });
    await expect(client.listLeagues()).resolves.toHaveLength(1);
    await expect(client.teams(leagueKey)).resolves.toHaveLength(2);
    const denied = new YahooClient("token", async () => new Response("no", { status: 401 }));
    await expect(denied.listLeagues()).rejects.toThrow(/connected again/);
  });
});
