import { z } from "zod";
import {
  sleeperLeagueSchema,
  sleeperMatchupsSchema,
  sleeperNflStateSchema,
  sleeperRostersSchema,
  sleeperUsersSchema,
} from "./schemas";

const BASE_URL = "https://api.sleeper.app/v1";
const REQUEST_TIMEOUT_MS = 8_000;

export type SleeperErrorCode =
  | "not_found"
  | "timeout"
  | "provider_unavailable"
  | "malformed_response";

export class SleeperApiError extends Error {
  constructor(
    public readonly code: SleeperErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SleeperApiError";
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: { nullMeansNotFound?: boolean } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (response.status === 404) {
      throw new SleeperApiError("not_found", "Sleeper resource was not found");
    }
    if (!response.ok) {
      throw new SleeperApiError(
        "provider_unavailable",
        `Sleeper returned HTTP ${response.status}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SleeperApiError(
        "malformed_response",
        "Sleeper returned invalid JSON",
      );
    }

    if (payload === null && options.nullMeansNotFound) {
      throw new SleeperApiError("not_found", "Sleeper resource was not found");
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new SleeperApiError(
        "malformed_response",
        "Sleeper response failed validation",
      );
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof SleeperApiError) throw error;
    if (controller.signal.aborted) {
      throw new SleeperApiError("timeout", "Sleeper request timed out");
    }
    throw new SleeperApiError(
      "provider_unavailable",
      "Sleeper could not be reached",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export class SleeperClient {
  constructor(private readonly leagueId: string) {}

  getLeague() {
    return request(`/league/${encodeURIComponent(this.leagueId)}`, sleeperLeagueSchema, {
      nullMeansNotFound: true,
    });
  }

  getUsers() {
    return request(
      `/league/${encodeURIComponent(this.leagueId)}/users`,
      sleeperUsersSchema,
    );
  }

  getRosters() {
    return request(
      `/league/${encodeURIComponent(this.leagueId)}/rosters`,
      sleeperRostersSchema,
    );
  }

  getMatchups(week: number) {
    return request(
      `/league/${encodeURIComponent(this.leagueId)}/matchups/${week}`,
      sleeperMatchupsSchema,
    );
  }

  getNflState() {
    return request("/state/nfl", sleeperNflStateSchema);
  }
}
