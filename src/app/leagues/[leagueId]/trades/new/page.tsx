import Link from "next/link";
import { getTradeComposer } from "@/lib/trades/queries";
import { LeagueError } from "@/lib/leagues/models";
import { TradeVoteForm } from "@/components/trade-form";

export const metadata = { title: "Create trade vote" };

export default async function NewTradeVote({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  let data;
  try {
    data = await getTradeComposer(leagueId);
  } catch (error) {
    return (
      <p role="alert">
        {error instanceof LeagueError ? error.message : "This vote could not be started."}
      </p>
    );
  }
  return (
    <>
      <Link href={`/trades?league=${data.league.id}`} className="back-link">
        ← Trades
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{data.league.name}</p>
          <h1>Create trade vote</h1>
          <p>
            CommishHQ records the decision. It does not send the trade to the fantasy platform.
          </p>
        </div>
      </div>
      <section className="settings-panel">
        <TradeVoteForm
          leagueId={data.league.id}
          teams={data.teams}
          timezone={data.league.timezone}
          participantsMayVote={data.preferences.participants_may_vote}
          defaultDeadline={data.defaultDeadline}
        />
      </section>
    </>
  );
}
