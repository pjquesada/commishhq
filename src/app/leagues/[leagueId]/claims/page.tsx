import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { reviewTeamClaim } from "@/app/leagues/actions";
import { SubmitButton } from "@/components/submit-button";

export default async function TeamClaims({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ error?: string; updated?: string }>;
}) {
  const user = await requireUser();
  const { leagueId } = await params;
  const query = await searchParams;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return (
      <section className="settings-panel">
        <h1>Team claims</h1>
        <p>Server-side Supabase access needs to be configured first.</p>
      </section>
    );
  }

  const { data: league } = await admin
    .from("leagues")
    .select("id,name,commissioner_id")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league || league.commissioner_id !== user.id) notFound();

  const [{ data: claims }, { data: teams }] = await Promise.all([
    admin
      .from("team_claims")
      .select("id,user_id,team_id,created_at")
      .eq("league_id", leagueId)
      .eq("status", "pending")
      .order("created_at"),
    admin.from("teams").select("id,name").eq("league_id", leagueId),
  ]);

  const teamNames = new Map((teams ?? []).map((team) => [team.id, team.name]));
  const claimRows = await Promise.all(
    (claims ?? []).map(async (claim) => {
      const { data } = await admin.auth.admin.getUserById(claim.user_id);
      return {
        ...claim,
        manager:
          data.user?.email ?? `Manager ${String(claim.user_id).slice(0, 8)}`,
      };
    }),
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">COMMISSIONER REVIEW</p>
          <h1>Team claims</h1>
          <p>{league.name}</p>
        </div>
        <Link className="button secondary" href={`/leagues/${leagueId}`}>
          Back to league
        </Link>
      </div>

      <section className="settings-panel">
        {query.error && (
          <p role="alert" className="form-error">
            The claim could not be reviewed. It may already have been handled
            or the team may already be assigned.
          </p>
        )}
        {query.updated && <p role="status">Team claim updated.</p>}

        {claimRows.length === 0 ? (
          <p>No pending claims.</p>
        ) : (
          claimRows.map((claim) => (
            <div className="settings-row" key={claim.id}>
              <div>
                <strong>{claim.manager}</strong>
                <p>
                  wants to claim{" "}
                  <strong>{teamNames.get(claim.team_id) ?? "Unknown team"}</strong>
                </p>
              </div>
              <div>
                <form action={reviewTeamClaim}>
                  <input type="hidden" name="claimId" value={claim.id} />
                  <input type="hidden" name="leagueId" value={leagueId} />
                  <input type="hidden" name="decision" value="approved" />
                  <SubmitButton pendingLabel="Approving…">Approve</SubmitButton>
                </form>
                <form action={reviewTeamClaim}>
                  <input type="hidden" name="claimId" value={claim.id} />
                  <input type="hidden" name="leagueId" value={leagueId} />
                  <input type="hidden" name="decision" value="rejected" />
                  <SubmitButton
                    pendingLabel="Rejecting…"
                    className="button secondary"
                  >
                    Reject
                  </SubmitButton>
                </form>
              </div>
            </div>
          ))
        )}
      </section>
    </>
  );
}
