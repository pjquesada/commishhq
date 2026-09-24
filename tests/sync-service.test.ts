import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  adminConfigured: vi.fn(),
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
  getLeague: vi.fn(),
  getTeams: vi.fn(),
  getManagers: vi.fn(),
  getMatchups: vi.fn(),
  getExisting: vi.fn(),
  provider: vi.fn(),
  log: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/supabase/admin", () => ({
  adminConfigured: mocks.adminConfigured,
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/fantasy/providers/sleeper", () => ({
  sleeperProvider: mocks.provider,
}));
vi.mock("@/lib/leagues/queries", () => ({ getLeague: mocks.getExisting }));
vi.mock("@/lib/leagues/log", () => ({ leagueLog: mocks.log }));
import { syncSleeperLeague } from "@/lib/leagues/sync";
import { ProviderError } from "@/lib/fantasy/providers/sleeper/client";
const user = "00000000-0000-4000-8000-000000000001",
  leagueId = "10000000-0000-4000-8000-000000000001",
  run = "20000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue({ id: user });
  mocks.adminConfigured.mockReturnValue(true);
  mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.provider.mockReturnValue({
    getLeague: mocks.getLeague,
    getTeams: mocks.getTeams,
    getManagers: mocks.getManagers,
    getMatchups: mocks.getMatchups,
  });
  mocks.getLeague.mockResolvedValue({
    id: "123",
    externalId: "123",
    name: "League",
    season: 2026,
    currentWeek: 7,
  });
  mocks.getTeams.mockResolvedValue([]);
  mocks.getManagers.mockResolvedValue([]);
  mocks.getMatchups.mockResolvedValue([]);
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "begin_sleeper_sync"
        ? { league_id: leagueId, run_id: run }
        : null,
    error: null,
  }));
});
describe("trusted import orchestration", () => {
  it("authenticates before creating an admin client or fetching provider data", async () => {
    mocks.requireUser.mockRejectedValue(new Error("Login required"));
    await expect(syncSleeperLeague("123")).rejects.toThrow("Login required");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("fails clearly when the private server configuration is absent", async () => {
    mocks.adminConfigured.mockReturnValue(false);
    await expect(syncSleeperLeague("123")).rejects.toThrow("server-only");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
  it("rejects malformed IDs before fetching", async () => {
    await expect(syncSleeperLeague("https://evil.test")).rejects.toThrow(
      "digits",
    );
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("does not permit noncommissioner refresh even with an admin key available", async () => {
    mocks.getExisting.mockResolvedValue({
      league: { commissioner_id: "someone-else" },
      user: { id: user },
    });
    await expect(syncSleeperLeague("123", leagueId)).rejects.toThrow(
      "commissioner",
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.getLeague).not.toHaveBeenCalled();
  });
  it("persists only under the verified user and database-issued lease", async () => {
    expect(await syncSleeperLeague("123")).toBe(leagueId);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "begin_sleeper_sync",
      expect.objectContaining({ actor: user, external_league: "123" }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "finish_sleeper_sync",
      expect.objectContaining({ actor: user, run }),
    );
    expect(mocks.log).toHaveBeenCalledWith("sync_complete", leagueId);
  });
  it("does not fetch current matchups for a different season", async () => {
    mocks.getLeague.mockResolvedValue({
      externalId: "123",
      name: "Old league",
      season: 2025,
      currentWeek: null,
    });
    await syncSleeperLeague("123");
    expect(mocks.getMatchups).not.toHaveBeenCalled();
  });
  it("records a provider failure and never reports successful completion", async () => {
    mocks.getTeams.mockRejectedValue(new ProviderError("malformed"));
    await expect(syncSleeperLeague("123")).rejects.toThrow("incomplete");
    expect(mocks.rpc).toHaveBeenCalledWith("fail_sleeper_sync", {
      actor: user,
      run,
      reason: "provider",
    });
    expect(
      mocks.rpc.mock.calls.some((call) => call[0] === "finish_sleeper_sync"),
    ).toBe(false);
    expect(mocks.log).not.toHaveBeenCalledWith("sync_complete", leagueId);
  });
  it("marks persistence failures explicitly", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      data:
        name === "begin_sleeper_sync"
          ? { league_id: leagueId, run_id: run }
          : null,
      error:
        name === "finish_sleeper_sync"
          ? { message: "internal database failure" }
          : null,
    }));
    await expect(syncSleeperLeague("123")).rejects.toThrow(
      "could not be saved",
    );
    expect(mocks.rpc).toHaveBeenCalledWith("fail_sleeper_sync", {
      actor: user,
      run,
      reason: "persistence",
    });
  });
  it("reports when failure status could not be saved rather than lying", async () => {
    mocks.getTeams.mockRejectedValue(new ProviderError("timeout"));
    mocks.rpc.mockImplementation(async (name: string) => ({
      data:
        name === "begin_sleeper_sync"
          ? { league_id: leagueId, run_id: run }
          : null,
      error: name === "fail_sleeper_sync" ? { message: "network" } : null,
    }));
    await expect(syncSleeperLeague("123")).rejects.toThrow(
      "status could not be saved",
    );
  });
});
