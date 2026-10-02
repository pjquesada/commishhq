import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listVotes } from "@/lib/trades/queries";
import { LeagueError, uuidSchema } from "@/lib/leagues/models";
import { TradeCard, tradeLines } from "@/components/trade-summary";

export const metadata = { title: "Trades" };

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string }>;
}) {
  const user = await requireUser("/trades");
  const { league: requested } = await searchParams;
  const leagueFilter = uuidSchema.safeParse(requested).success ? requested : undefined;
  let data;
  try {
    data = await listVotes(leagueFilter);
  } catch (error) {
    return (
      <p role="alert">
        {error instanceof LeagueError
          ? error.message
          : "Trade votes could not be loaded. Apply the latest database migration and try again."}
      </p>
    );
  }
  const names = new Map(data.teams.map((team) => [team.id, team.name]));
  const leagueName = new Map(data.leagues.map((league) => [league.id, league.name]));
  const timezone = new Map(data.leagues.map((league) => [league.id, league.timezone]));
  const active = data.votes.filter((vote) => vote.status === "open");
  const past = data.votes.filter((vote) => vote.status !== "open" && vote.status !== "draft");
  const selected = leagueFilter
    ? data.leagues.find((league) => league.id === leagueFilter)
    : data.leagues[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ONE TEAM, ONE VOTE</p>
          <h1>Trades</h1>
          <p>League trade votes, with a deadline and a private ballot.</p>
        </div>
      </div>
      {data.leagues.length > 1 && (
        <nav className="league-switcher" aria-label="Leagues">
          {data.leagues.map((league) => (
            <Link
              key={league.id}
              href={`/trades?league=${league.id}`}
              aria-current={league.id === (leagueFilter ?? selected?.id) ? "page" : undefined}
            >
              {league.name}
            </Link>
          ))}
        </nav>
      )}
      {selected?.commissioner_id === user.id && (
        <p>
          <Link className="button" href={`/leagues/${selected.id}/trades/new`}>
            Create trade vote
          </Link>
        </p>
      )}
      <section className="settings-panel">
        <h2>Active votes</h2>
        {active.length === 0 && <p>No open votes.</p>}
        {active.map((vote) => (
          <TradeCard
            key={vote.id}
            vote={vote}
            lines={tradeLines(vote, data.sides, data.assets, names)}
            leagueName={leagueName.get(vote.league_id) ?? "League"}
            timezone={timezone.get(vote.league_id) ?? "America/New_York"}
            progress={data.progress.get(vote.id)}
          />
        ))}
      </section>
      <section className="settings-panel">
        <h2>Past votes</h2>
        {past.length === 0 && <p>No closed votes yet.</p>}
        {past.map((vote) => (
          <TradeCard
            key={vote.id}
            vote={vote}
            lines={tradeLines(vote, data.sides, data.assets, names)}
            leagueName={leagueName.get(vote.league_id) ?? "League"}
            timezone={timezone.get(vote.league_id) ?? "America/New_York"}
          />
        ))}
      </section>
    </>
  );
}
