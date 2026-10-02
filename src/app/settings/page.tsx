import { requireUser } from "@/lib/auth/session";
import { signOut } from "@/app/auth/actions";
import { providerAvailability } from "@/lib/fantasy/provider";
import { listLeagues } from "@/lib/leagues/queries";
import { createClient } from "@/lib/supabase/server";
import { VotePreferencesForm } from "@/components/trade-actions";
import Link from "next/link";
import { z } from "zod";
export const metadata = { title: "Settings" };
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ league?: string }>;
}) {
  const user = await requireUser("/settings");
  const { league: requested } = await searchParams;
  const leagues = await listLeagues().catch(() => []);
  const selected =
    leagues.find((league) => league.id === requested) ?? leagues[0];
  let preferences = { participants_may_vote: false, default_vote_hours: 48 };
  if (selected && selected.commissioner_id === user.id) {
    const client = await createClient();
    const loaded = await client
      .from("league_preferences")
      .select("participants_may_vote,default_vote_hours")
      .eq("league_id", selected.id)
      .maybeSingle();
    const parsed = z
      .object({ participants_may_vote: z.boolean(), default_vote_hours: z.number() })
      .safeParse(loaded.data);
    if (parsed.success) preferences = parsed.data;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE YOURSELF AT HOME</p>
          <h1>Settings</h1>
          <p>Your account and league connections.</p>
        </div>
      </div>
      <section className="settings-panel">
        <h2>Your account</h2>
        <p>
          Signed in as <strong>{user.email}</strong>
        </p>
        <form action={signOut}>
          <button className="button secondary">Sign out</button>
        </form>
      </section>
      <section className="settings-panel">
        <h2>League connections</h2>
        <p>
          Connect your Sleeper league. Yahoo and ESPN will follow in later
          phases.
        </p>
        {providerAvailability.map((p) => (
          <div className="settings-row" key={p.id}>
            <strong>{p.name}</strong>
            {p.id === "sleeper" ? (
              <Link className="button secondary" href="/leagues/new">
                Connect now
              </Link>
            ) : (
              <span className="tag">{p.label}</span>
            )}
          </div>
        ))}
      </section>
      {selected && selected.commissioner_id === user.id && (
        <section className="settings-panel">
          <h2>Trade voting</h2>
          {leagues.length > 1 && (
            <nav className="league-switcher" aria-label="Leagues">
              {leagues
                .filter((league) => league.commissioner_id === user.id)
                .map((league) => (
                  <Link
                    key={league.id}
                    href={`/settings?league=${league.id}`}
                    aria-current={league.id === selected.id ? "page" : undefined}
                  >
                    {league.name}
                  </Link>
                ))}
            </nav>
          )}
          <VotePreferencesForm
            leagueId={selected.id}
            participantsMayVote={preferences.participants_may_vote}
            defaultVoteHours={preferences.default_vote_hours}
          />
        </section>
      )}
      <section className="settings-panel">
        <h2>Notifications</h2>
        <p>
          Not enabled. Web Push opt-in will be available in a later release.
        </p>
      </section>
    </>
  );
}
