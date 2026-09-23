import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { SleeperAdapter, SleeperApiError } from "@/lib/fantasy/providers/sleeper";
import type { League, LeagueMember, LeagueSettings, Team } from "@/lib/fantasy/types";

export const sleeperLeagueIdSchema = z
  .string()
  .trim()
  .regex(/^\d{6,30}$/, "Enter a valid Sleeper League ID");

export type LeagueSyncErrorCode =
  | "not_found"
  | "timeout"
  | "provider_unavailable"
  | "malformed_response"
  | "already_connected"
  | "not_configured"
  | "database";

export class LeagueSyncError extends Error {
  constructor(
    public readonly code: LeagueSyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LeagueSyncError";
  }
}

async function findExistingLeague(
  admin: ReturnType<typeof createAdminClient>,
  externalLeagueId: string,
) {
  const { data, error } = await admin
    .from("league_connections")
    .select("league_id")
    .eq("provider", "sleeper")
    .eq("external_id", externalLeagueId)
    .maybeSingle();

  if (error) throw new LeagueSyncError("database", "Could not check league");
  return data?.league_id as string | undefined;
}

async function assertCommissioner(
  admin: ReturnType<typeof createAdminClient>,
  leagueId: string,
  userId: string,
) {
  const { data, error } = await admin
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();

  if (error) throw new LeagueSyncError("database", "Could not load league");
  if (data.commissioner_id !== userId) {
    throw new LeagueSyncError(
      "already_connected",
      "This league is already connected by another commissioner",
    );
  }
}

async function createLeague(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  externalLeagueId: string,
  league: {
    name: string;
    season: number;
    sport: string;
    status: string;
    totalTeams: number;
    currentWeek: number | null;
    timezone: string;
  },
) {
  const { data: created, error: leagueError } = await admin
    .from("leagues")
    .insert({
      name: league.name,
      season: league.season,
      commissioner_id: userId,
      timezone: league.timezone,
      sport: league.sport,
      status: league.status,
      total_teams: league.totalTeams,
      current_week: league.currentWeek,
      sync_status: "syncing",
    })
    .select("id")
    .single();

  if (leagueError || !created) {
    throw new LeagueSyncError("database", "Could not create league");
  }

  const leagueId = created.id as string;
  const { error: connectionError } = await admin
    .from("league_connections")
    .insert({
      league_id: leagueId,
      provider: "sleeper",
      external_id: externalLeagueId,
    });

  if (!connectionError) return leagueId;

  await admin.from("leagues").delete().eq("id", leagueId);

  if (connectionError.code === "23505") {
    const existing = await findExistingLeague(admin, externalLeagueId);
    if (existing) {
      await assertCommissioner(admin, existing, userId);
      return existing;
    }
  }

  throw new LeagueSyncError("database", "Could not connect league");
}

function mapProviderError(error: SleeperApiError) {
  return new LeagueSyncError(error.code, error.message);
}

export async function syncSleeperLeague(
  externalLeagueId: string,
  userId: string,
) {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    throw new LeagueSyncError(
      "not_configured",
      "Server-side Supabase access is not configured",
    );
  }

  const adapter = new SleeperAdapter(externalLeagueId);

  let normalizedLeague: League;
  let members: LeagueMember[];
  let teams: Team[];
  let settings: LeagueSettings;

  try {
    [normalizedLeague, members, teams, settings] = await Promise.all([
      adapter.getLeague(),
      adapter.getLeagueMembers(),
      adapter.getTeams(),
      adapter.getLeagueSettings(),
    ]);
  } catch (error) {
    if (error instanceof SleeperApiError) throw mapProviderError(error);
    throw error;
  }

  let existingLeagueId = await findExistingLeague(admin, externalLeagueId);
  if (existingLeagueId) {
    await assertCommissioner(admin, existingLeagueId, userId);
  } else {
    existingLeagueId = await createLeague(
      admin,
      userId,
      externalLeagueId,
      normalizedLeague,
    );
  }

  const leagueId = existingLeagueId;
  const { data: run, error: runError } = await admin
    .from("sync_runs")
    .insert({
      league_id: leagueId,
      provider: "sleeper",
      external_id: externalLeagueId,
      status: "running",
    })
    .select("id")
    .single();

  if (runError || !run) {
    throw new LeagueSyncError("database", "Could not start league sync");
  }

  const runId = run.id as string;

  try {
    const week =
      normalizedLeague.currentWeek && normalizedLeague.currentWeek >= 1
        ? normalizedLeague.currentWeek
        : null;
    const matchups = week ? await adapter.getMatchups(week) : [];

    const { error: leagueUpdateError } = await admin
      .from("leagues")
      .update({
        name: normalizedLeague.name,
        season: normalizedLeague.season,
        timezone: normalizedLeague.timezone,
        sport: normalizedLeague.sport,
        status: normalizedLeague.status,
        total_teams: settings.teamCount,
        current_week: normalizedLeague.currentWeek,
        sync_status: "syncing",
      })
      .eq("id", leagueId);

    if (leagueUpdateError) {
      throw new LeagueSyncError("database", "Could not update league");
    }

    const teamRows = teams.map((team) => ({
      league_id: leagueId,
      external_id: team.externalId,
      name: team.name,
      owner_external_id: team.ownerExternalId,
      avatar: team.avatar,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      points_for: team.pointsFor,
      points_against: team.pointsAgainst,
    }));

    const persistedTeams =
      teamRows.length === 0
        ? []
        : await (async () => {
            const { data, error } = await admin
              .from("teams")
              .upsert(teamRows, { onConflict: "league_id,external_id" })
              .select("id,external_id");
            if (error || !data) {
              throw new LeagueSyncError("database", "Could not sync teams");
            }
            return data;
          })();

    const databaseTeamByExternalId = new Map(
      persistedTeams.map((team) => [String(team.external_id), String(team.id)]),
    );
    const databaseTeamByDomainId = new Map(
      teams.flatMap((team) => {
        const id = databaseTeamByExternalId.get(team.externalId);
        return id ? [[team.id, id] as const] : [];
      }),
    );

    const providerMemberRows = members.map((member) => {
      const providerTeam = teams.find((team) =>
        team.managers.some(
          (manager) => manager.externalId === member.providerUserId,
        ),
      );
      return {
        league_id: leagueId,
        provider_user_id: member.providerUserId,
        username: member.username,
        display_name: member.displayName,
        avatar: member.avatar,
        is_provider_commissioner: member.isProviderCommissioner,
        team_id: providerTeam
          ? (databaseTeamByExternalId.get(providerTeam.externalId) ?? null)
          : null,
      };
    });

    if (providerMemberRows.length > 0) {
      const { error: memberError } = await admin
        .from("provider_league_members")
        .upsert(providerMemberRows, {
          onConflict: "league_id,provider_user_id",
        });
      if (memberError) {
        throw new LeagueSyncError("database", "Could not sync league members");
      }
    }

    const matchupRows = matchups.flatMap((matchup) =>
      matchup.scores.flatMap((score) => {
        const teamId = databaseTeamByDomainId.get(score.teamId);
        if (!teamId) return [];
        const opponent = matchup.scores.find(
          (candidate) => candidate.teamId !== score.teamId,
        );
        return [
          {
            league_id: leagueId,
            week: matchup.week,
            provider_matchup_id: matchup.id,
            team_id: teamId,
            opponent_team_id: opponent
              ? (databaseTeamByDomainId.get(opponent.teamId) ?? null)
              : null,
            points: score.points,
            opponent_points: opponent?.points ?? null,
            status: matchup.status,
          },
        ];
      }),
    );

    if (matchupRows.length > 0) {
      const { error: matchupError } = await admin
        .from("matchups")
        .upsert(matchupRows, { onConflict: "league_id,week,team_id" });
      if (matchupError) {
        throw new LeagueSyncError("database", "Could not sync matchups");
      }
    }

    const completedAt = new Date().toISOString();
    const { error: completeError } = await admin
      .from("leagues")
      .update({
        sync_status: "complete",
        last_synced_at: completedAt,
      })
      .eq("id", leagueId);

    if (completeError) {
      throw new LeagueSyncError("database", "Could not finish league sync");
    }

    await admin
      .from("sync_runs")
      .update({ status: "complete", completed_at: completedAt })
      .eq("id", runId);

    return { leagueId };
  } catch (error) {
    const code =
      error instanceof LeagueSyncError ? error.code : "database";
    const completedAt = new Date().toISOString();

    await Promise.all([
      admin
        .from("leagues")
        .update({ sync_status: "failed" })
        .eq("id", leagueId),
      admin
        .from("sync_runs")
        .update({
          status: "failed",
          error_code: code,
          completed_at: completedAt,
        })
        .eq("id", runId),
    ]);

    if (error instanceof LeagueSyncError) throw error;
    throw new LeagueSyncError("database", "League sync failed");
  }
}
