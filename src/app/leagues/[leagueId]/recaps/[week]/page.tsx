import Link from "next/link";
import { notFound } from "next/navigation";
import { getRecap } from "@/lib/recaps/queries";
import { restyleRecap, saveRecapEdits } from "@/app/recaps/actions";
import { LeagueError } from "@/lib/leagues/models";

export const metadata = { title: "Recap" };

export default async function RecapPage({
  params,
}: {
  params: Promise<{ leagueId: string; week: string }>;
}) {
  const { leagueId, week: weekText } = await params;
  const week = Number(weekText);
  let data;
  try {
    data = await getRecap(leagueId, week);
  } catch (error) {
    if (error instanceof LeagueError) notFound();
    throw error;
  }
  return (
      <>
        <Link href={`/recaps?league=${leagueId}`} className="back-link">
          ← Recaps
        </Link>
        <div className="page-heading">
          <div>
            <p className="eyebrow">{data.leagueName.toUpperCase()}</p>
            <h1>Week {data.recap.week}</h1>
          </div>
        </div>
        <article className="recap-body">{data.recap.body}</article>
        {data.commissioner && (
          <section className="settings-panel">
            <h2>Commissioner edits</h2>
            <div className="action-row">
              {(
                [
                  ["again", "Regenerate"],
                  ["funnier", "Make funnier"],
                  ["meaner", "Make meaner"],
                  ["softer", "Tone it down"],
                  ["shorter", "Shorten"],
                ] as const
              ).map(([intent, label]) => (
                <form key={intent} action={restyleRecap}>
                  <input type="hidden" name="leagueId" value={leagueId} />
                  <input type="hidden" name="week" value={week} />
                  <input type="hidden" name="intent" value={intent} />
                  <button className="button secondary" type="submit">
                    {label}
                  </button>
                </form>
              ))}
            </div>
            <form action={saveRecapEdits} className="stack">
              <input type="hidden" name="recapId" value={data.recap.id} />
              <input type="hidden" name="leagueId" value={leagueId} />
              <input type="hidden" name="week" value={week} />
              <label>
                Edit the recap
                <textarea name="body" rows={10} defaultValue={data.recap.body} required />
              </label>
              <label className="check">
                <input type="checkbox" name="resend" />
                Resend notifications
              </label>
              <button className="button" type="submit">
                Save edit
              </button>
            </form>
          </section>
        )}
      </>
  );
}
