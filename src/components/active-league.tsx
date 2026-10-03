import Link from "next/link";
import { getDashboard } from "@/lib/leagues/queries";
import { LeagueError, type LeagueRow } from "@/lib/leagues/models";
import { standings } from "@/lib/fantasy/standings";
import { leagueHighlights } from "@/lib/recaps/queries";

export async function ActiveLeague({
  leagueId,
  leagues,
}: {
  leagueId: string;
  leagues: LeagueRow[];
}) {
  let data;
  try {
    data = await getDashboard(leagueId);
  } catch (error) {
    return (
      <p role="alert">
        {error instanceof LeagueError ? error.message : "This league could not be loaded."}
      </p>
    );
  }
  const highlights = await leagueHighlights(leagueId);
  const { league, teams, matchups } = data;
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
  return (
    <section className="settings-panel">
      {leagues.length > 1 && (
        <nav className="league-switcher" aria-label="Leagues">
          {leagues.map((item) => (
            <Link
              key={item.id}
              href={`/?league=${item.id}`}
              aria-current={item.id === league.id ? "page" : undefined}
            >
              {item.name}
            </Link>
          ))}
        </nav>
      )}
      <div className="section-title">
        <div>
          <h2>{league.name}</h2>
          <p>
            {data.connection.provider} ·{" "}
            {league.current_week ? `Week ${league.current_week}` : "No active week"} · Sync{" "}
            {league.sync_status}
          </p>
        </div>
        <Link href={`/leagues/${league.id}`}>Open league</Link>
      </div>
      <p>
        {highlights.voteId ? (
          <Link href={`/leagues/${league.id}/trades/${highlights.voteId}`}>
            A trade vote needs attention.{" "}
          </Link>
        ) : (
          <span>No open trade vote. </span>
        )}
        {highlights.week ? (
          <Link href={`/leagues/${league.id}/recaps/${highlights.week}`}>
            Latest recap: Week {highlights.week}
          </Link>
        ) : (
          <span>No recap yet.</span>
        )}
      </p>
      <h3>Standings</h3>
      {ordered.length === 0 ? (
        <p>No teams imported yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Standings</caption>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Team</th>
                <th scope="col">W–L–T</th>
                <th scope="col">PF</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((team) => (
                <tr key={team.id}>
                  <td>{team.rank}</td>
                  <th scope="row">{team.name}</th>
                  <td>
                    {team.wins}–{team.losses}–{team.ties}
                  </td>
                  <td>{team.points_for.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>Matchups</h3>
      {games.length === 0 ? (
        <p>No current matchups.</p>
      ) : (
        <div className="matchup-grid">
          {games.map((game) => (
            <article className="matchup-card" key={game.team_id}>
              <span className="tag">{game.status}</span>
              <div>
                <strong>{names.get(game.team_id) ?? "Team"}</strong>
                <b>{game.team_score?.toFixed(2) ?? "—"}</b>
              </div>
              <div>
                <span>{game.opponent_id ? (names.get(game.opponent_id) ?? "Opponent") : "No opponent"}</span>
                <b>{game.opponent_score?.toFixed(2) ?? "—"}</b>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
