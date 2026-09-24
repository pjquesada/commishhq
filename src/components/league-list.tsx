import Link from "next/link";
import { listLeagues } from "@/lib/leagues/queries";
export async function LeagueList() {
  const result = await listLeagues()
    .then((leagues) => ({ leagues, error: "" }))
    .catch(() => ({
      leagues: [],
      error:
        "Could not load your leagues. Check your Supabase connection and apply the Phase 2 migration.",
    }));
  return (
    <section className="settings-panel">
      <div className="section-title">
        <h2>Your leagues</h2>
        <Link className="button" href="/leagues/new">
          Connect Sleeper ↗
        </Link>
      </div>
      {result.error ? (
        <p role="alert">{result.error}</p>
      ) : result.leagues.length === 0 ? (
        <p>
          No approved league memberships yet. Import your league or use your
          commissioner’s claim link.
        </p>
      ) : (
        result.leagues.map((league) => (
          <Link
            key={league.id}
            className="league-list-row"
            href={`/leagues/${league.id}`}
          >
            <div>
              <strong>{league.name}</strong>
              <p>
                {league.season} ·{" "}
                {league.current_week
                  ? `Week ${league.current_week}`
                  : "No active week"}
              </p>
            </div>
            <span className="tag">{league.sync_status}</span>
            <span>→</span>
          </Link>
        ))
      )}
    </section>
  );
}
