import type { FantasyProvider } from "../../provider";
import type { LeagueSettings } from "../../types";
import { SleeperClient, ProviderError } from "./client";
import { mapLeague, mapTeams, mapMatchups } from "./mapper";
/** Request-scoped only: never share this adapter/cache between synchronization attempts. */
export class SleeperAdapter implements FantasyProvider {
  readonly provider = "sleeper" as const;
  private leaguePromise?: ReturnType<SleeperClient["league"]>;
  private statePromise?: ReturnType<SleeperClient["state"]>;
  private usersPromise?: ReturnType<SleeperClient["users"]>;
  private teamsPromise?: ReturnType<SleeperAdapter["loadTeams"]>;
  constructor(private readonly client: SleeperClient) {}
  private league() {
    return (this.leaguePromise ??= this.client.league().then((league) => {
      if (league.league_id !== this.client.leagueId)
        throw new ProviderError("malformed");
      return league;
    }));
  }
  private state() {
    return (this.statePromise ??= this.client.state());
  }
  private users() {
    return (this.usersPromise ??= this.client.users());
  }
  async getManagers() {
    const users = await this.users();
    if (new Set(users.map((u) => u.user_id)).size !== users.length)
      throw new ProviderError("malformed");
    return users.map((user) => ({
      externalId: user.user_id,
      displayName:
        user.display_name?.trim() ||
        user.username?.trim() ||
        `Manager ${user.user_id}`,
    }));
  }
  async getLeague() {
    const [league, state] = await Promise.all([this.league(), this.state()]);
    return mapLeague(league, state);
  }
  private async loadTeams() {
    const [league, rosters, users] = await Promise.all([
      this.league(),
      this.client.rosters(),
      this.users(),
    ]);
    if (rosters.length !== league.total_rosters)
      throw new ProviderError("malformed");
    return mapTeams(this.client.leagueId, rosters, users);
  }
  getTeams() {
    return (this.teamsPromise ??= this.loadTeams());
  }
  async getMatchups(week: number) {
    const [league, state, rows, teams] = await Promise.all([
      this.league(),
      this.state(),
      this.client.matchups(week),
      this.getTeams(),
    ]);
    return mapMatchups(league, state, week, rows, teams);
  }
  async getLeagueSettings(): Promise<LeagueSettings> {
    const league = await this.league();
    return {
      teamCount: league.total_rosters,
      scoring:
        league.scoring_settings.rec === 0
          ? "standard"
          : league.scoring_settings.rec === 0.5
            ? "half-ppr"
            : league.scoring_settings.rec === 1
              ? "ppr"
              : "custom",
      playoffStartWeek: league.settings.playoff_week_start ?? null,
    };
  }
  capabilities() {
    return {
      matchups: true,
      standings: true,
      transactions: false,
      projections: false,
    };
  }
}
