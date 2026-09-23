import type { FantasyProvider } from "../../provider";
import type { ProviderCapabilities } from "../../types";
import { SleeperClient } from "./client";
import {
  mapSleeperLeague,
  mapSleeperLeagueSettings,
  mapSleeperMatchups,
  mapSleeperMembers,
  mapSleeperTeams,
} from "./mapper";

export class SleeperAdapter implements FantasyProvider {
  readonly provider = "sleeper" as const;
  private readonly client: SleeperClient;
  private leaguePromise?: ReturnType<SleeperClient["getLeague"]>;
  private usersPromise?: ReturnType<SleeperClient["getUsers"]>;
  private rostersPromise?: ReturnType<SleeperClient["getRosters"]>;
  private statePromise?: ReturnType<SleeperClient["getNflState"]>;

  constructor(private readonly leagueId: string) {
    this.client = new SleeperClient(leagueId);
  }

  private rawLeague() {
    return (this.leaguePromise ??= this.client.getLeague());
  }

  private rawUsers() {
    return (this.usersPromise ??= this.client.getUsers());
  }

  private rawRosters() {
    return (this.rostersPromise ??= this.client.getRosters());
  }

  private nflState() {
    return (this.statePromise ??= this.client.getNflState());
  }

  async getLeague() {
    const [league, state] = await Promise.all([
      this.rawLeague(),
      this.nflState(),
    ]);
    return mapSleeperLeague(league, state);
  }

  async getLeagueMembers() {
    return mapSleeperMembers(this.leagueId, await this.rawUsers());
  }

  async getTeams() {
    const [users, rosters] = await Promise.all([
      this.rawUsers(),
      this.rawRosters(),
    ]);
    return mapSleeperTeams(this.leagueId, users, rosters);
  }

  async getMatchups(week: number) {
    const [league, state, rows] = await Promise.all([
      this.rawLeague(),
      this.nflState(),
      this.client.getMatchups(week),
    ]);
    const normalizedLeague = mapSleeperLeague(league, state);
    return mapSleeperMatchups(
      this.leagueId,
      week,
      rows,
      normalizedLeague.currentWeek,
      league.status,
    );
  }

  async getLeagueSettings() {
    return mapSleeperLeagueSettings(await this.rawLeague());
  }

  capabilities(): ProviderCapabilities {
    return {
      matchups: true,
      standings: true,
      transactions: false,
      projections: false,
    };
  }
}
