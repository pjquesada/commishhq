import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getClaimPage } from "@/lib/leagues/queries";
import { LeagueError } from "@/lib/leagues/models";
import { ClaimForm, CancelClaimForm } from "@/components/league-forms";
import { LeagueNotice } from "@/components/league-notice";
export const metadata = { title: "Claim your team" };
export default async function ClaimPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  await requireUser(`/leagues/${leagueId}/claim`);
  let data;
  try {
    data = await getClaimPage(leagueId);
  } catch (error) {
    return (
      <LeagueNotice
        message={
          error instanceof LeagueError
            ? error.message
            : "Claim data is unavailable. Check the Phase 2 database setup."
        }
      />
    );
  }
  const active = data.claims.find((claim) =>
    ["pending", "approved"].includes(claim.status),
  );
  return (
    <section className="auth-panel">
      <p className="eyebrow">{data.options.season} · TEAM IDENTITY</p>
      <h1>{data.options.name}</h1>
      <p>
        Your Sleeper name and your CommishHQ account are separate. Your
        commissioner will verify this request.
      </p>
      {active ? (
        <div className="setup-notice">
          <h2>
            {data.options.teams.find((team) => team.id === active.team_id)
              ?.name ?? "Your team"}
          </h2>
          <p>
            Status: <strong>{active.status}</strong>
          </p>
          {active.status === "pending" ? (
            <>
              <p>
                Waiting for your commissioner. You do not have league access
                yet.
              </p>
              <CancelClaimForm leagueId={leagueId} claimId={active.id} />
            </>
          ) : (
            <Link href={`/leagues/${leagueId}`} className="button">
              Open your league →
            </Link>
          )}
        </div>
      ) : (
        <ClaimForm options={data.options} />
      )}
      <div className="claim-history">
        {data.claims
          .filter((claim) => claim.id !== active?.id)
          .map((claim) => (
            <p key={claim.id}>
              {data.options.teams.find((team) => team.id === claim.team_id)
                ?.name ?? "Team"}{" "}
              · {claim.status}
            </p>
          ))}
      </div>
    </section>
  );
}
