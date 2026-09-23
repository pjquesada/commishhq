import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { rankTeams } from "@/lib/fantasy/standings";
import type { Team } from "@/lib/fantasy/types";
import { resyncSleeperLeague } from "@/app/leagues/actions";
import { SubmitButton } from "@/components/submit-button";

export default async function LeaguePage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ error?: string; synced?: string }>;
}) {
  const user = await requireUser();
  const { leagueId } = await params;
  const query = await searchParams;
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select(
      "id,name,season,commissioner_id,current_week,status,total_teams,sync_status,last_synced_at",
    )
    .eq("id", leagueId)
    .maybeSingle();

  if (!league) notFound();

  const [{ data: connection }, { data: teamRows }, { data: claim }] =
    await Promise.all([
      supabase
        .from("league_connections")
        .select("provider,external_id")
        .eq("league_id", leagueId)
        .maybeSingle(),
      supabase
        .from("teams")
        .select(
          "id,external_id,name,owner_external_id,avatar,wins,losses,ties,points_for,points_against",
        )
        .eq("league_id", leagueId),
      supabase
        .from("team_claims")
        .select("status,team_id")
        .eq("league_id", leagueId)
        .eq("user_id", user.id)
        .in("status", ["pending", "approved"])
        .maybeSingle(),
    ]);

  const teams: Team[] = (teamRows ?? []).map((team) => ({
    id: team.id,
    leagueId,
    externalId: String(team.external_id),
    name: team.name,
    ownerExternalId: team.owner_external_id,
    avatar: team.avatar,
    managers: [],
    wins: team.wins,
    losses: team.losses,
    ties: team.ties,
    pointsFor: Number(team.points_for),
    pointsAgainst: Number(team.points_against),
  }));
  const standings = rankTeams(teams);
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));

  let matchupRows: Array<{
    id: string;
    provider_matchup_id: string;
    team_id: string;
    opponent_team_id: string | null;
    points: number | null;
    opponent_points: number | null;
    status: string;
  }> = [];

  if (league.current_week && league.current_week >= 1) {
    const { data } = await supabase
      .from("matchups")
      .select(
        "id,provider_matchup_id,team_id,opponent_team_id,points,opponent_points,status",
      )
      .eq("league_id", leagueId)
      .eq("week", league.current_week);
    matchupRows = (data ?? []).map((row) => ({
      ...row,
      points: row.points === null ? null : Number(row.points),
      opponent_points:
        row.opponent_points === null ? null : Number(row.opponent_points),
    }));
  }

  const seenMatchups = new Set<string>();
  const matchups = matchupRows.filter((row) => {
    if (seenMatchups.has(row.provider_matchup_id)) return false;
    seenMatchups.add(row.provider_matchup_id);
    return true;
  });

  const isCommissioner = league.commissioner_id === user.id;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {String(connection?.provider ?? "FANTASY").toUpperCase()} •{" "}
            {league.season}
          </p>
          <h1>{league.name}</h1>
          <p>
            {league.current_week
              ? `Week ${league.current_week}`
              : "No active fantasy week"}{" "}
            • {league.total_teams} teams
          </p>
        </div>
        <span className="pill">
          <span className="status-dot" /> {league.sync_status}
        </span>
      </div>

      {query.error && (
        <section className="settings-panel">
          <p role="alert" className="form-error">
            The league could not be refreshed. Try again in a moment.
          </p>
        </section>
      )}
      {query.synced && (
        <section className="settings-panel">
          <p role="status">Sleeper data refreshed.</p>
        </section>
      )}

      <section className="settings-panel">
        <div className="section-title">
          <h2>Standings</h2>
          <span className="muted">{standings.length} teams</span>
        </div>
        {standings.map((team, index) => (
          <div className="settings-row" key={team.id}>
            <div>
              <strong>
                {index + 1}. {team.name}
              </strong>
              <p>
                {team.wins}-{team.losses}
                {team.ties ? `-${team.ties}` : ""} •{" "}
                {team.pointsFor.toFixed(2)} PF
              </p>
            </div>
            <span className="tag">{team.pointsAgainst.toFixed(2)} PA</span>
          </div>
        ))}
      </section>

      <section className="settings-panel">
        <div className="section-title">
          <h2>
            {league.current_week
              ? `Week ${league.current_week} matchups`
              : "This week"}
          </h2>
          <span className="muted">{matchups.length} matchups</span>
        </div>
        {matchups.length === 0 ? (
          <p>No current-week matchup data is available yet.</p>
        ) : (
          matchups.map((matchup) => (
            <div className="settings-row" key={matchup.id}>
              <div>
                <strong>{teamNames.get(matchup.team_id) ?? "Team"}</strong>
                <p>
                  {matchup.points === null
                    ? "—"
                    : matchup.points.toFixed(2)}{" "}
                  points
                </p>
              </div>
              <span className="muted">vs</span>
              <div>
                <strong>
                  {matchup.opponent_team_id
                    ? (teamNames.get(matchup.opponent_team_id) ?? "Team")
                    : "Bye"}
                </strong>
                <p>
                  {matchup.opponent_points === null
                    ? "—"
                    : matchup.opponent_points.toFixed(2)}{" "}
                  points
                </p>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="settings-panel">
        <h2>Team identity</h2>
        <p>
          {claim?.status === "approved"
            ? "Your team assignment is approved."
            : claim?.status === "pending"
              ? "Your team claim is waiting for commissioner approval."
              : "Claim your team before secure league voting launches."}
        </p>
        <Link className="button secondary" href={`/leagues/${leagueId}/claim`}>
          {claim ? "View team claim" : "Claim your team"}
        </Link>
      </section>

      {isCommissioner && (
        <section className="settings-panel">
          <h2>Commissioner</h2>
          <p>
            Review team claims or refresh Sleeper. Results remain read-only in
            Sleeper; CommishHQ stores its own verified manager assignments.
          </p>
          <div className="settings-row">
            <Link
              className="button secondary"
              href={`/leagues/${leagueId}/claims`}
            >
              Review team claims
            </Link>
            <form action={resyncSleeperLeague}>
              <input type="hidden" name="leagueId" value={leagueId} />
              <SubmitButton pendingLabel="Refreshing…">
                Refresh Sleeper
              </SubmitButton>
            </form>
          </div>
          <p>
            Team claim link:{" "}
            <Link href={`/leagues/${leagueId}/claim`}>
              /leagues/{leagueId}/claim
            </Link>
          </p>
        </section>
      )}
    </>
  );
}
