import type {
  League,
  Team,
  Matchup,
  Transaction,
  LeagueSettings,
  ProviderCapabilities,
  ProviderId,
} from "./types";

/** An adapter is scoped to a single external league; responses must be validated before mapping. */
export interface FantasyProvider {
  readonly provider: ProviderId;
  getLeague(): Promise<League>;
  getTeams(): Promise<Team[]>;
  getManagers?(): Promise<import("./types").ProviderManager[]>;
  getMatchups(week: number): Promise<Matchup[]>;
  getTransactions?(week?: number): Promise<Transaction[]>;
  getLeagueSettings(): Promise<LeagueSettings>;
  capabilities(): ProviderCapabilities;
}

export const providerAvailability = [
  { id: "sleeper", name: "Sleeper", label: "Connect now" },
  { id: "yahoo", name: "Yahoo Fantasy", label: "Coming Soon" },
  { id: "espn", name: "ESPN Fantasy", label: "Coming Soon" },
] as const;
