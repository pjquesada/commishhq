import { SleeperAdapter } from "./adapter";
import { SleeperClient } from "./client";
export function sleeperProvider(leagueId: string) {
  return new SleeperAdapter(new SleeperClient(leagueId));
}
