import { collectLeagues, collectMatchups, collectTeams, toLeague, type YahooLeagueCard } from "./mapper";
import type { League, Matchup, Team } from "../../types";

export class YahooError extends Error {
  constructor(public readonly code: "unauthorized" | "unavailable" | "malformed") {
    super(
      code === "unauthorized"
        ? "Yahoo needs to be connected again."
        : "Yahoo did not return usable league data.",
    );
  }
}

export class YahooClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async get(path: string): Promise<unknown> {
    const joiner = path.includes("?") ? "&" : "?";
    let response: Response;
    try {
      response = await this.fetcher(
        `https://fantasysports.yahooapis.com/fantasy/v2/${path}${joiner}format=json`,
        { headers: { authorization: `Bearer ${this.token}`, accept: "application/json" } },
      );
    } catch {
      throw new YahooError("unavailable");
    }
    if (response.status === 401) throw new YahooError("unauthorized");
    if (!response.ok) throw new YahooError("unavailable");
    return response.json();
  }

  async listLeagues(): Promise<YahooLeagueCard[]> {
    const cards = collectLeagues(await this.get("users;use_login=1/games;game_codes=nfl/leagues"));
    if (cards.length === 0) throw new YahooError("malformed");
    return cards;
  }

  async league(leagueKey: string): Promise<League> {
    const [card] = collectLeagues(await this.get(`league/${leagueKey}`)).filter(
      (league) => league.leagueKey === leagueKey,
    );
    if (!card) throw new YahooError("malformed");
    return toLeague(card);
  }

  async teams(leagueKey: string): Promise<Team[]> {
    const teams = collectTeams(leagueKey, await this.get(`league/${leagueKey}/standings`));
    if (teams.length === 0) throw new YahooError("malformed");
    return teams;
  }

  async matchups(leagueKey: string, week: number): Promise<Matchup[]> {
    return collectMatchups(leagueKey, week, await this.get(`league/${leagueKey}/scoreboard;week=${week}`));
  }
}
