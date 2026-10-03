import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { yahooConfigured } from "@/lib/fantasy/providers/yahoo/oauth";
import { YahooClient } from "@/lib/fantasy/providers/yahoo/client";
import { yahooAccessToken } from "@/lib/leagues/yahoo-sync";
import { LeagueError } from "@/lib/leagues/models";
import { importYahooLeague } from "./actions";

export const metadata = { title: "Connect Yahoo" };

export default async function YahooConnect({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string; error?: string }>;
}) {
  const user = await requireUser("/leagues/yahoo");
  const query = await searchParams;
  let leagues: { leagueKey: string; name: string; season: number }[] = [];
  let message = "";
  if (yahooConfigured() && !query.setup) {
    try {
      const token = await yahooAccessToken(user.id);
      leagues = await new YahooClient(token).listLeagues();
    } catch (error) {
      message = error instanceof LeagueError ? error.message : "Yahoo could not be reached.";
    }
  }
  return (
    <section className="auth-panel">
      <p className="eyebrow">YAHOO FANTASY</p>
      <h1>Connect Yahoo.</h1>
      <p>CommishHQ reads the league. Lineups, waivers, and trades still happen on Yahoo.</p>
      {query.error && <p role="alert">Yahoo could not be connected. Try again.</p>}
      {!yahooConfigured() || query.setup ? (
        <div className="setup-notice">
          <h2>Yahoo app setup</h2>
          <p>
            Create a Yahoo Fantasy app with the <code>fspt-r</code> scope and set
            YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, YAHOO_REDIRECT_URI, and
            PROVIDER_TOKEN_ENCRYPTION_KEY on the server. The redirect URI is
            /api/yahoo/callback.
          </p>
        </div>
      ) : (
        <p>
          <Link className="button" href="/api/yahoo/start">
            Connect Yahoo account
          </Link>
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {leagues.map((league) => (
        <form key={league.leagueKey} action={importYahooLeague} className="settings-row">
          <input type="hidden" name="leagueKey" value={league.leagueKey} />
          <strong>
            {league.name}
            <span className="muted"> {league.season}</span>
          </strong>
          <button className="button secondary" type="submit">
            Import
          </button>
        </form>
      ))}
      <p>
        Importing a Yahoo league does not claim a team for you. Ask the commissioner to approve
        your team, the same way Sleeper leagues do.
      </p>
    </section>
  );
}
