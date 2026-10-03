import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listRecaps } from "@/lib/recaps/queries";
import { uuidSchema } from "@/lib/leagues/models";

export const metadata = { title: "Recaps" };

export default async function RecapsPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string }>;
}) {
  await requireUser("/recaps");
  const { league: requested } = await searchParams;
  const leagueId = uuidSchema.safeParse(requested).success ? requested : undefined;
  const { recaps, leagues } = await listRecaps(leagueId);
  const selected = leagues.find((league) => league.id === leagueId) ?? leagues[0];
  const visible = selected ? recaps.filter((recap) => recap.league_id === selected.id) : recaps;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">TUESDAY MORNING</p>
          <h1>Recaps</h1>
          <p>One recap for the week. The jokes stay about the box score.</p>
        </div>
      </div>
      {leagues.length > 1 && (
        <nav className="league-switcher" aria-label="Leagues">
          {leagues.map((league) => (
            <Link
              key={league.id}
              href={`/recaps?league=${league.id}`}
              aria-current={league.id === selected?.id ? "page" : undefined}
            >
              {league.name}
            </Link>
          ))}
        </nav>
      )}
      {visible.length === 0 ? (
        <p>No recap yet. The Tuesday job writes one after the week is final.</p>
      ) : (
        <ul className="recap-list">
          {visible.map((recap) => (
            <li key={recap.id}>
              <Link href={`/leagues/${recap.league_id}/recaps/${recap.week}`}>
                Week {recap.week}
                <span className="muted"> {recap.season}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
