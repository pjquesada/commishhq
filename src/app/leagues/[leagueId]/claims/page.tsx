import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getReviewPage } from "@/lib/leagues/queries";
import { LeagueError } from "@/lib/leagues/models";
import { ReviewForm } from "@/components/league-forms";
import { LeagueNotice } from "@/components/league-notice";
export const metadata = { title: "Review team claims" };
export default async function ClaimsPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  await requireUser(`/leagues/${leagueId}/claims`);
  let data;
  try {
    data = await getReviewPage(leagueId);
  } catch (error) {
    return (
      <LeagueNotice
        message={
          error instanceof LeagueError
            ? error.message
            : "Claims are unavailable. Verify the Phase 2 migration."
        }
      />
    );
  }
  return (
    <>
      <Link href={`/leagues/${leagueId}`} className="back-link">
        ← {data.league.name}
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">COMMISSIONER ONLY</p>
          <h1>Team claims</h1>
          <p>
            Confirm the requester’s email with the manager you know before
            approving. A matching Sleeper display name proves nothing.
          </p>
        </div>
      </div>
      {data.claims.length === 0 ? (
        <section className="settings-panel">
          <p>
            No team requests yet. Share the claim link from your league page.
          </p>
        </section>
      ) : (
        data.claims.map((claim) => (
          <section className="settings-panel" key={claim.id}>
            <div className="section-title">
              <h2>
                {data.teams.find((team) => team.id === claim.team_id)?.name ??
                  "Team"}
              </h2>
              <span className="tag">{claim.status}</span>
            </div>
            <p>
              Requested by <strong>{claim.requester_label}</strong>
              <br />
              <small>Account: {claim.requester_id}</small>
            </p>
            {claim.status === "pending" ? (
              <ReviewForm leagueId={leagueId} claimId={claim.id} />
            ) : (
              <p className="table-note">
                Reviewed:{" "}
                {claim.reviewed_at
                  ? new Date(claim.reviewed_at).toISOString()
                  : "—"}
              </p>
            )}
          </section>
        ))
      )}
    </>
  );
}
