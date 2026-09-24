import { z } from "zod";
import {
  sleeperIdSchema,
  sleeperLeagueSchema,
  sleeperUserSchema,
  sleeperRosterSchema,
  sleeperStateSchema,
  sleeperMatchupSchema,
} from "./schemas";
export class ProviderError extends Error {
  constructor(
    public readonly code:
      "not_found" | "timeout" | "unavailable" | "malformed" | "invalid_id",
  ) {
    super(
      {
        not_found: "Sleeper league not found. Check the league ID.",
        timeout: "Sleeper took too long to respond. Please try again.",
        unavailable:
          "Sleeper is temporarily unavailable. Please try again later.",
        malformed:
          "Sleeper returned incomplete or inconsistent data. Nothing was replaced. Try again later.",
        invalid_id: "Enter a valid Sleeper League ID.",
      }[code],
    );
  }
}
export class SleeperClient {
  readonly leagueId: string;
  constructor(
    leagueId: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 8000,
  ) {
    const result = sleeperIdSchema.safeParse(leagueId);
    if (!result.success) throw new ProviderError("invalid_id");
    this.leagueId = result.data;
  }
  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    try {
      const response = await this.fetcher(
        `https://api.sleeper.app/v1/${path}`,
        {
          signal: AbortSignal.timeout(this.timeoutMs),
          cache: "no-store",
          redirect: "error",
        },
      );
      if (response.status === 404) throw new ProviderError("not_found");
      if (!response.ok) throw new ProviderError("unavailable");
      const raw: unknown = await response.json();
      if (raw === null) throw new ProviderError("not_found");
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new ProviderError("malformed");
      return parsed.data;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (
        error instanceof Error &&
        ["AbortError", "TimeoutError"].includes(error.name)
      )
        throw new ProviderError("timeout");
      if (error instanceof SyntaxError) throw new ProviderError("malformed");
      throw new ProviderError("unavailable");
    }
  }
  league() {
    return this.get(`league/${this.leagueId}`, sleeperLeagueSchema);
  }
  users() {
    return this.get(
      `league/${this.leagueId}/users`,
      z.array(sleeperUserSchema).max(200),
    );
  }
  rosters() {
    return this.get(
      `league/${this.leagueId}/rosters`,
      z.array(sleeperRosterSchema).min(1).max(100),
    );
  }
  state() {
    return this.get("state/nfl", sleeperStateSchema);
  }
  matchups(week: number) {
    z.number().int().min(1).max(22).parse(week);
    return this.get(
      `league/${this.leagueId}/matchups/${week}`,
      z.array(sleeperMatchupSchema).max(100),
    );
  }
}
