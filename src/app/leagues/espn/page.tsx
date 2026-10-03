import { requireUser } from "@/lib/auth/session";
import { espnExperimentalEnabled } from "@/lib/fantasy/providers/espn/client";
import { importEspnLeague, storeEspnSession } from "./actions";

export const metadata = { title: "Connect ESPN" };

export default async function EspnConnect({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireUser("/leagues/espn");
  const query = await searchParams;
  const experimental = espnExperimentalEnabled();
  return (
    <section className="auth-panel">
      <p className="eyebrow">UNOFFICIAL ESPN READ</p>
      <h1>Connect ESPN.</h1>
      <p>
        ESPN does not offer an official fantasy OAuth API for this app. Public leagues can be
        imported by league ID. This is not an ESPN product, and the read endpoint is unofficial.
      </p>
      {query.error && <p role="alert">ESPN could not be imported. Check the league ID and try again.</p>}
      {query.saved && <p role="status">Experimental session saved. It is stored encrypted and is not shown again.</p>}
      <form action={importEspnLeague} className="stack">
        <label>
          League ID
          <input name="leagueId" inputMode="numeric" required />
        </label>
        <label>
          Season
          <input name="season" inputMode="numeric" placeholder="2026" required />
        </label>
        <button className="button" type="submit">
          Import public league
        </button>
      </form>
      <h2>Experimental private leagues</h2>
      {experimental ? (
        <form action={storeEspnSession} className="stack">
          <p>
            espn_s2 and SWID are sensitive session cookies. They are accepted only on the server,
            encrypted, and never written to logs or sent back to the browser. Delete them by
            revoking the ESPN connection. Verify the provider terms before a public commercial release.
          </p>
          <label>
            espn_s2
            <input name="espnS2" type="password" autoComplete="off" required />
          </label>
          <label>
            SWID
            <input name="swid" type="password" autoComplete="off" required />
          </label>
          <button className="button secondary" type="submit">
            Save experimental session
          </button>
        </form>
      ) : (
        <p>Private ESPN sessions are off. Set ENABLE_ESPN_EXPERIMENTAL=true only after reviewing the risk.</p>
      )}
    </section>
  );
}
