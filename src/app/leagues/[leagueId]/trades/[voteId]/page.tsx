import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getVote } from "@/lib/trades/queries";
import { LeagueError } from "@/lib/leagues/models";
import { formatWhen } from "@/lib/time";
import { tradeLines } from "@/components/trade-summary";
import { BallotForm } from "@/components/ballot-form";
import { CancelVoteForm, PublishIdentitiesForm } from "@/components/trade-actions";

export const metadata = { title: "Trade vote" };

export default async function TradeVotePage({
  params,
}: {
  params: Promise<{ leagueId: string; voteId: string }>;
}) {
  const { leagueId, voteId } = await params;
  const user = await requireUser(`/leagues/${leagueId}/trades/${voteId}`);
  let data;
  try {
    data = await getVote(leagueId, voteId);
  } catch (error) {
    return (
      <p role="alert">
        {error instanceof LeagueError ? error.message : "This vote could not be loaded."}
      </p>
    );
  }
  const names = new Map(data.teams.map((team) => [team.id, team.name]));
  const league = data.leagues.find((item) => item.id === leagueId);
  const lines = tradeLines(data.vote, data.sides, data.assets, names);
  const commissioner = league?.commissioner_id === user.id;
  const open = data.progress.status === "open";
  const privacy =
    data.vote.privacy_mode === "anonymous"
      ? "This ballot is anonymous. Totals appear after the deadline. Individual choices are never published."
      : "After the deadline, the commissioner may publish how each eligible team voted. That rule was set before voting opened and cannot be changed.";
  return (
    <>
      <Link href={`/trades?league=${leagueId}`} className="back-link">
        ← Trades
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{league?.name}</p>
          <h1>Trade vote</h1>
          <p>Closes {formatWhen(data.vote.closes_at, league?.timezone ?? "America/New_York")}</p>
        </div>
        <span className="pill">{open ? "Open" : data.progress.status}</span>
      </div>
      <section className="settings-panel">
        {lines.map((line) => (
          <p key={line}>
            <strong>{line}</strong>
          </p>
        ))}
        <p>{privacy}</p>
        {open && (
          <p role="status">
            {data.progress.votes_cast} of {data.progress.eligible_count} eligible teams voted
          </p>
        )}
        {data.results && data.results.status === "closed" && (
          <p>
            {data.results.outcome === "vetoed" ? "Vetoed" : "Approved"}.{" "}
            {data.results.approve_count} approve, {data.results.veto_count} veto.{" "}
            {data.results.required_veto_votes} vetoes were required.
          </p>
        )}
        {data.results?.identities && (
          <ul>
            {data.results.identities.map((identity) => (
              <li key={identity.team_id}>
                {names.get(identity.team_id) ?? "Team"} voted {identity.choice}
              </li>
            ))}
          </ul>
        )}
        {open && data.progress.viewer_eligible && !data.progress.viewer_has_voted && (
          <BallotForm
            leagueId={leagueId}
            voteId={voteId}
            siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined}
          />
        )}
        {open && data.progress.viewer_has_voted && <p>Your ballot is in. One team, one vote.</p>}
        {open && !data.progress.viewer_eligible && <p>Your team is not eligible for this vote.</p>}
        {commissioner && open && <CancelVoteForm leagueId={leagueId} voteId={voteId} />}
        {commissioner &&
          data.vote.privacy_mode === "commissioner_may_reveal_after_close" &&
          data.progress.status === "closed" &&
          !data.vote.identities_published && (
            <PublishIdentitiesForm leagueId={leagueId} voteId={voteId} />
          )}
      </section>
    </>
  );
}
