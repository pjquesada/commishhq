import Link from "next/link";
import { formatWhen } from "@/lib/time";
import type { TradeProgress, TradeVote } from "@/lib/trades/queries";

type Side = { id: string; vote_id: string; team_id: string; side_index: number };
type Asset = { side_id: string; vote_id: string; label: string; sort_order: number };

export function tradeLines(
  vote: TradeVote,
  sides: Side[],
  assets: Asset[],
  names: Map<string, string>,
) {
  return sides
    .filter((side) => side.vote_id === vote.id)
    .sort((a, b) => a.side_index - b.side_index)
    .map((side) => {
      const labels = assets
        .filter((asset) => asset.side_id === side.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((asset) => asset.label);
      return `${names.get(side.team_id) ?? "Team"} receives ${labels.join(" + ")}`;
    });
}

export function TradeCard({
  vote,
  lines,
  leagueName,
  timezone,
  progress,
}: {
  vote: TradeVote;
  lines: string[];
  leagueName: string;
  timezone: string;
  progress?: TradeProgress;
}) {
  const open = vote.status === "open";
  return (
    <article className="trade-card">
      <div className="section-title">
        <h3>{leagueName}</h3>
        <span className="pill">
          {open ? "Open" : vote.status === "cancelled" ? "Cancelled" : vote.outcome}
        </span>
      </div>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <p>Closes {formatWhen(vote.closes_at, timezone)}</p>
      {open && progress && (
        <p>
          <strong>
            {progress.votes_cast} of {progress.eligible_count}
          </strong>{" "}
          eligible teams voted
        </p>
      )}
      {!open && vote.status === "closed" && (
        <p>
          {vote.outcome === "vetoed" ? "Vetoed" : "Approved"}. {vote.veto_count} veto
          {vote.veto_count === 1 ? "" : "es"} of {vote.required_veto_votes} required.
        </p>
      )}
      <Link className="button secondary" href={`/leagues/${vote.league_id}/trades/${vote.id}`}>
        Open vote
      </Link>
    </article>
  );
}
