"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { syncSleeperLeague } from "@/lib/leagues/sync";
import { getLeague } from "@/lib/leagues/queries";
import { LeagueError, databaseError, uuidSchema } from "@/lib/leagues/models";
import { ProviderError } from "@/lib/fantasy/providers/sleeper/client";
import { leagueLog } from "@/lib/leagues/log";
export type LeagueActionState = { error?: string; message?: string };
function message(error: unknown): LeagueActionState {
  return {
    error:
      error instanceof LeagueError || error instanceof ProviderError
        ? error.message
        : "This request could not be completed. Try again.",
  };
}
export async function importLeague(
  _state: LeagueActionState,
  form: FormData,
): Promise<LeagueActionState> {
  await requireUser("/leagues/new");
  let id: string;
  try {
    id = await syncSleeperLeague(String(form.get("externalId") ?? ""));
  } catch (error) {
    return message(error);
  }
  revalidatePath("/");
  redirect(`/leagues/${id}`);
}
export async function resyncLeague(
  _state: LeagueActionState,
  form: FormData,
): Promise<LeagueActionState> {
  await requireUser();
  const id = uuidSchema.safeParse(form.get("leagueId"));
  if (!id.success) return { error: "Invalid league." };
  try {
    const { user, league, client } = await getLeague(id.data);
    if (league.commissioner_id !== user.id)
      throw new LeagueError("Only the commissioner can sync this league.");
    const connection = await client
      .from("league_connections")
      .select("external_id")
      .eq("league_id", id.data)
      .single();
    if (connection.error) throw databaseError(connection.error.message);
    await syncSleeperLeague(String(connection.data.external_id), id.data);
    revalidatePath(`/leagues/${id.data}`);
    revalidatePath("/");
    return { message: "League refreshed." };
  } catch (error) {
    revalidatePath(`/leagues/${id.data}`);
    return message(error);
  }
}
export async function requestClaim(
  _state: LeagueActionState,
  form: FormData,
): Promise<LeagueActionState> {
  await requireUser();
  const league = uuidSchema.safeParse(form.get("leagueId"));
  const team = uuidSchema.safeParse(form.get("teamId"));
  if (!league.success || !team.success)
    return { error: "Choose a valid team." };
  const client = await createClient();
  const result = await client.rpc("request_team_claim", {
    target: league.data,
    requested_team: team.data,
  });
  if (result.error) return message(databaseError(result.error.message));
  leagueLog("claim_requested", league.data);
  revalidatePath(`/leagues/${league.data}/claim`);
  return {
    message:
      "Request sent. You will become this team’s manager only after commissioner approval.",
  };
}
export async function reviewClaim(
  _state: LeagueActionState,
  form: FormData,
): Promise<LeagueActionState> {
  await requireUser();
  const leagueId = uuidSchema.safeParse(form.get("leagueId"));
  const claimId = uuidSchema.safeParse(form.get("claimId"));
  const decision = form.get("decision");
  if (
    !leagueId.success ||
    !claimId.success ||
    (decision !== "approved" && decision !== "rejected")
  )
    return { error: "Invalid review." };
  try {
    const { user, league, client } = await getLeague(leagueId.data);
    if (league.commissioner_id !== user.id)
      throw new LeagueError("Only the commissioner can review claims.");
    const claim = await client
      .from("team_claims")
      .select("id")
      .eq("id", claimId.data)
      .eq("league_id", league.id)
      .maybeSingle();
    if (claim.error || !claim.data) throw new LeagueError("Claim not found.");
    const result = await client.rpc("review_team_claim", {
      target_claim: claimId.data,
      decision,
    });
    if (result.error) throw databaseError(result.error.message);
    leagueLog("claim_reviewed", league.id);
    revalidatePath(`/leagues/${league.id}`);
    revalidatePath(`/leagues/${league.id}/claims`);
    revalidatePath(`/leagues/${league.id}/claim`);
    return {
      message:
        decision === "approved"
          ? "Team assignment approved."
          : "Claim rejected.",
    };
  } catch (error) {
    return message(error);
  }
}
export async function cancelClaim(
  _state: LeagueActionState,
  form: FormData,
): Promise<LeagueActionState> {
  await requireUser();
  const id = uuidSchema.safeParse(form.get("claimId"));
  const league = uuidSchema.safeParse(form.get("leagueId"));
  if (!id.success || !league.success) return { error: "Invalid claim." };
  const client = await createClient();
  const result = await client.rpc("cancel_team_claim", {
    target_claim: id.data,
  });
  if (result.error) return message(databaseError(result.error.message));
  revalidatePath(`/leagues/${league.data}/claim`);
  return { message: "Claim cancelled. You may request another team." };
}
