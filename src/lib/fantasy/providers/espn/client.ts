import { mapEspnLeague, mapEspnMatchups, mapEspnTeams, parseEspnLeague } from "./mapper";
import type { League, Matchup, Team } from "../../types";

export class EspnError extends Error {
  constructor(public readonly code: "not_found" | "unauthorized" | "unavailable" | "malformed" | "disabled") {
    super(
      {
        not_found: "ESPN league not found. Public leagues can be imported with the league ID.",
        unauthorized: "ESPN did not accept the saved session.",
        unavailable: "ESPN did not return usable league data.",
        malformed: "ESPN returned a shape CommishHQ does not recognize. Nothing was saved.",
        disabled: "Experimental ESPN private leagues are turned off.",
      }[code],
    );
  }
}

export function espnExperimentalEnabled(): boolean {
  return process.env.ENABLE_ESPN_EXPERIMENTAL === "true";
}

/** Strip session material if it ever reaches an error string. */
export function redactEspn(value: string): string {
  return value.replace(/espn_s2=[^;\s]+/gi, "espn_s2=[redacted]").replace(/SWID=[^;\s]+/gi, "SWID=[redacted]");
}

export class EspnClient {
  constructor(
    private readonly leagueId: string,
    private readonly season: number,
    private readonly fetcher: typeof fetch = fetch,
    private readonly session?: { espnS2: string; swid: string },
  ) {}

  private async load() {
    if (this.session && !espnExperimentalEnabled()) throw new EspnError("disabled");
    let response: Response;
    try {
      response = await this.fetcher(
        `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${this.season}/segments/0/leagues/${this.leagueId}?view=mTeam&view=mMatchup&view=mSettings`,
        this.session
          ? { headers: { cookie: `espn_s2=${this.session.espnS2}; SWID=${this.session.swid}` } }
          : undefined,
      );
    } catch (error) {
      if (error instanceof EspnError) throw error;
      throw new EspnError("unavailable");
    }
    if (response.status === 404) throw new EspnError("not_found");
    if (response.status === 401 || response.status === 403) throw new EspnError("unauthorized");
    if (!response.ok) throw new EspnError("unavailable");
    try {
      return parseEspnLeague(await response.json());
    } catch {
      throw new EspnError("malformed");
    }
  }

  async league(): Promise<League> {
    return mapEspnLeague(await this.load());
  }
  async teams(): Promise<Team[]> {
    return mapEspnTeams(await this.load());
  }
  async matchups(week: number): Promise<Matchup[]> {
    return mapEspnMatchups(await this.load(), week);
  }

  async snapshot() {
    const payload = await this.load();
    const league = mapEspnLeague(payload);
    const through = league.currentWeek ?? 1;
    const history = [];
    for (let week = 1; week < through; week += 1) history.push(...mapEspnMatchups(payload, week));
    return {
      league,
      teams: mapEspnTeams(payload),
      matchups: league.currentWeek ? mapEspnMatchups(payload, league.currentWeek) : [],
      history,
    };
  }
}
