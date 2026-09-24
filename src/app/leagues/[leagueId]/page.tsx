import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getDashboard } from "@/lib/leagues/queries";
import { LeagueError } from "@/lib/leagues/models";
import { standings } from "@/lib/fantasy/standings";
import { adminConfigured } from "@/lib/supabase/admin";
import { SyncForm } from "@/components/league-forms";
import { ClaimLink } from "@/components/claim-link";
import { LeagueNotice } from "@/components/league-notice";
export const metadata = { title: "League" };
export default async function LeaguePage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  await requireUser(`/leagues/${leagueId}`);
  let data;
  try {
    data = await getDashboard(leagueId);
  } catch (error) {
    return (
      <LeagueNotice
        message={
          error instanceof LeagueError
            ? error.message
            : "Unable to load league data. Verify that the Phase 2 migration is applied."
        }
      />
    );
  }
  const { league, user, teams, matchups, managers, links } = data;
  const ordered = standings(
    teams.map((team) => ({
      ...team,
      externalId: team.external_id,
      pointsFor: team.points_for,
    })),
  );
  const names = new Map(teams.map((team) => [team.id, team.name]));
  const seen = new Set<string>();
  const games = matchups.filter((row) => {
    if (seen.has(row.team_id)) return false;
    seen.add(row.team_id);
    if (row.opponent_id) seen.add(row.opponent_id);
    return true;
  });
  const commissioner = user.id === league.commissioner_id;
  return (
    <>
      <Link href="/" className="back-link">
        ← Your leagues
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {data.connection.provider.toUpperCase()} · {league.season}
          </p>
          <h1>{league.name}</h1>
          <p>
            {league.current_week
              ? `NFL week ${league.current_week}`
              : "No active NFL week for this league season"}
          </p>
        </div>
        <span className="pill">Sync: {league.sync_status}</span>
      </div>
      {league.sync_status !== "complete" && (
        <p className="sync-warning" role="status">
          {league.sync_status === "failed"
            ? "The last sync failed."
            : "A sync is pending or in progress."}{" "}
          {league.last_synced_at
            ? "Showing the last successfully imported data."
            : "No completed import is available yet."}{" "}
          {league.sync_status === "syncing"
            ? "If interrupted, retry after two minutes."
            : ""}
        </p>
      )}
      {commissioner && (
        <section className="settings-panel">
          <div className="action-row">
            <SyncForm leagueId={league.id} configured={adminConfigured()} />
            <Link
              className="button secondary"
              href={`/leagues/${league.id}/claims`}
            >
              Review team claims
            </Link>
          </div>
          <ClaimLink leagueId={league.id} />
        </section>
      )}
      <section className="settings-panel">
        <div className="section-title">
          <h2>Standings</h2>
          <span className="muted">{teams.length} teams</span>
        </div>
        <p className="table-note">
          Win percentage (ties count as half a win), then points for, then
          roster ID. Custom Sleeper playoff tiebreakers may differ.
        </p>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">
              League standings and Sleeper managers
            </caption>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Team / Sleeper manager</th>
                <th scope="col">W–L–T</th>
                <th scope="col">PF</th>
                <th scope="col">PA</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((team) => (
                <tr key={team.id}>
                  <td>{team.rank}</td>
                  <th scope="row">
                    <strong>{team.name}</strong>
                    <small>
                      {links
                        .filter((link) => link.team_id === team.id)
                        .map(
                          (link) =>
                            managers.find(
                              (manager) =>
                                manager.external_id ===
                                link.manager_external_id,
                            )?.display_name,
                        )
                        .filter(Boolean)
                        .join(", ") || "Unassigned on Sleeper"}
                    </small>
                  </th>
                  <td>
                    {team.wins}–{team.losses}–{team.ties}
                  </td>
                  <td>{team.points_for.toFixed(2)}</td>
                  <td>{team.points_against.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {teams.length === 0 && <p>No teams imported yet.</p>}
      </section>
      <section className="settings-panel">
        <h2>
          {league.current_week
            ? `Week ${league.current_week} matchups`
            : "Current matchups"}
        </h2>
        {games.length === 0 ? (
          <p>
            {league.current_week
              ? "Sleeper has no matchup rows for this week."
              : "Current NFL state does not match this league’s season and season type. No current-week matchups were fetched."}
          </p>
        ) : (
          <div className="matchup-grid">
            {games.map((game) => (
              <article className="matchup-card" key={game.team_id}>
                <span className="tag">{game.status}</span>
                <div>
                  <strong>{names.get(game.team_id) ?? "Inactive team"}</strong>
                  <b>{game.team_score?.toFixed(2) ?? "—"}</b>
                </div>
                <div>
                  <span>
                    {game.opponent_id
                      ? (names.get(game.opponent_id) ?? "Inactive opponent")
                      : "No paired opponent"}
                  </span>
                  <b>{game.opponent_score?.toFixed(2) ?? "—"}</b>
                </div>
              </article>
            ))}
          </div>
        )}
        <p className="table-note">
          Scores reflect the last refresh. “Live” means the scoring period is
          not marked final; it is not a real-time game clock.
        </p>
      </section>
      {!commissioner && (
        <Link className="button secondary" href={`/leagues/${league.id}/claim`}>
          Your team assignment
        </Link>
      )}
      {league.last_synced_at && (
        <p className="table-note">
          Last successful sync:{" "}
          {new Date(league.last_synced_at).toLocaleString("en-US", {
            timeZone: "UTC",
          })}{" "}
          UTC
        </p>
      )}
    </>
  );
}
