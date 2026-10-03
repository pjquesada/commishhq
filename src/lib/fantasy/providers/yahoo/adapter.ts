import type { FantasyProvider } from "../../provider";
import type { LeagueSettings, Matchup } from "../../types";
import { YahooClient } from "./client";

export class YahooAdapter implements FantasyProvider {
  readonly provider = "yahoo" as const;
  constructor(private readonly client: YahooClient, private readonly leagueKey: string) {}

  getLeague() {
    return this.client.league(this.leagueKey);
  }
  getTeams() {
    return this.client.teams(this.leagueKey);
  }
  getMatchups(week: number) {
    return this.client.matchups(this.leagueKey, week);
  }
  async getMatchupHistory(throughWeek: number): Promise<Matchup[]> {
    const last = Math.min(Math.max(throughWeek, 1), 18);
    const games: Matchup[] = [];
    for (let week = 1; week < last; week += 1) games.push(...(await this.getMatchups(week)));
    return games;
  }
  async getLeagueSettings(): Promise<LeagueSettings> {
    const league = await this.getLeague();
    return { teamCount: league.totalTeams ?? 0, scoring: "custom", playoffStartWeek: null };
  }
  capabilities() {
    return {
      matchups: true,
      standings: true,
      transactions: false,
      projections: false,
      publicLeagueAccess: false,
      oauth: true,
      matchupHistory: true,
      futureDraftPicks: false,
      commissionerActions: false,
    };
  }
}
