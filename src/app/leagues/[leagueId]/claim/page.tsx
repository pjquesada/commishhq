import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestTeamClaim } from "@/app/leagues/actions";
import { SubmitButton } from "@/components/submit-button";

const errors: Record<string, string> = {
  "not-configured": "Team claiming is not configured on the server yet.",
  "invalid-team": "That team is not part of this league.",
  "already-approved": "You already have an approved team in this league.",
  "active-claim": "You already have an active team claim in this league.",
  "claim-failed": "CommishHQ could not submit your claim. Try again.",
};

export default async function ClaimTeam({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ error?: string; requested?: string }>;
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
        <h1>Team claiming</h1>
        <p>Server-side Supabase access needs to be configured first.</p>
      </section>
    );
  }

  const [{ data: league }, { data: teams }, { data: membership }, { data: claim }] =
    await Promise.all([
      admin
        .from("leagues")
        .select("id,name,season,sync_status")
        .eq("id", leagueId)
        .maybeSingle(),
      admin
        .from("teams")
        .select("id,name")
        .eq("league_id", leagueId)
        .order("name"),
      admin
        .from("league_members")
        .select("team_id")
        .eq("league_id", leagueId)
        .eq("user_id", user.id)
        .maybeSingle(),
      admin
        .from("team_claims")
        .select("id,team_id,status")
        .eq("league_id", leagueId)
        .eq("user_id", user.id)
        .in("status", ["pending", "approved"])
        .maybeSingle(),
    ]);

  if (!league) notFound();

  const { data: claimedMemberships } = await admin
    .from("league_members")
    .select("team_id")
    .eq("league_id", leagueId);

  const claimedTeamIds = new Set(
    (claimedMemberships ?? [])
      .map((row) => row.team_id as string | null)
      .filter((id): id is string => Boolean(id)),
  );

  const claimTeam = (teams ?? []).find((team) => team.id === claim?.team_id);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">TEAM IDENTITY</p>
          <h1>{league.name}</h1>
          <p>Choose your team. The commissioner approves the request.</p>
        </div>
      </div>

      <section className="settings-panel">
        {query.error && (
          <p role="alert" className="form-error">
            {errors[query.error] ?? "Something went wrong with your claim."}
          </p>
        )}
        {query.requested && (
          <p role="status">
            Claim submitted. Your commissioner needs to approve it before it
            becomes your team identity.
          </p>
        )}

        {membership?.team_id ? (
          <>
            <h2>Team approved</h2>
            <p>Your CommishHQ account is already assigned to a team here.</p>
          </>
        ) : claim?.status === "pending" ? (
          <>
            <h2>Claim pending</h2>
            <p>
              Your request for <strong>{claimTeam?.name ?? "this team"}</strong>{" "}
              is waiting for commissioner approval.
            </p>
          </>
        ) : (
          <form action={requestTeamClaim} className="auth-form">
            <input type="hidden" name="leagueId" value={leagueId} />
            <label>
              Which team is yours?
              <select name="teamId" required defaultValue="">
                <option value="" disabled>
                  Select your team
                </option>
                {(teams ?? []).map((team) => (
                  <option
                    key={team.id}
                    value={team.id}
                    disabled={claimedTeamIds.has(team.id)}
                  >
                    {team.name}
                    {claimedTeamIds.has(team.id) ? " — already claimed" : ""}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton pendingLabel="Submitting claim…">
              Request team
            </SubmitButton>
          </form>
        )}
      </section>
    </>
  );
}
