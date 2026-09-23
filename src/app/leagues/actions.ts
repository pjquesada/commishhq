"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  LeagueSyncError,
  sleeperLeagueIdSchema,
  syncSleeperLeague,
} from "@/lib/fantasy/sync/sleeper";

const uuidSchema = z.uuid();

function redirectImportError(code: string): never {
  redirect(`/leagues/new?error=${encodeURIComponent(code)}`);
}

export async function importSleeperLeague(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const parsed = sleeperLeagueIdSchema.safeParse(formData.get("leagueId"));
  if (!parsed.success) redirectImportError("invalid");

  let result: { leagueId: string };
  try {
    result = await syncSleeperLeague(parsed.data, user.id);
  } catch (error) {
    if (error instanceof LeagueSyncError) redirectImportError(error.code);
    redirectImportError("unexpected");
  }

  redirect(`/leagues/${result.leagueId}`);
}

export async function resyncSleeperLeague(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const leagueId = uuidSchema.safeParse(formData.get("leagueId"));
  if (!leagueId.success) redirect("/settings?error=invalid-league");

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    redirect(`/leagues/${leagueId.data}?error=not-configured`);
  }

  const { data: connection } = await admin
    .from("league_connections")
    .select("provider,external_id")
    .eq("league_id", leagueId.data)
    .single();

  if (!connection || connection.provider !== "sleeper") {
    redirect(`/leagues/${leagueId.data}?error=provider`);
  }

  try {
    await syncSleeperLeague(String(connection.external_id), user.id);
  } catch (error) {
    const code = error instanceof LeagueSyncError ? error.code : "unexpected";
    redirect(
      `/leagues/${leagueId.data}?error=${encodeURIComponent(code)}`,
    );
  }

  revalidatePath(`/leagues/${leagueId.data}`);
  redirect(`/leagues/${leagueId.data}?synced=1`);
}

export async function requestTeamClaim(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const leagueId = uuidSchema.safeParse(formData.get("leagueId"));
  const teamId = uuidSchema.safeParse(formData.get("teamId"));
  if (!leagueId.success || !teamId.success) redirect("/");

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    redirect(`/leagues/${leagueId.data}/claim?error=not-configured`);
  }

  const { data: team, error: teamError } = await admin
    .from("teams")
    .select("id")
    .eq("id", teamId.data)
    .eq("league_id", leagueId.data)
    .maybeSingle();

  if (teamError || !team) {
    redirect(`/leagues/${leagueId.data}/claim?error=invalid-team`);
  }

  const { data: existingMembership } = await admin
    .from("league_members")
    .select("team_id")
    .eq("league_id", leagueId.data)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingMembership?.team_id) {
    redirect(`/leagues/${leagueId.data}/claim?error=already-approved`);
  }

  const { error } = await admin.from("team_claims").insert({
    league_id: leagueId.data,
    team_id: teamId.data,
    user_id: user.id,
    status: "pending",
  });

  if (error) {
    const code = error.code === "23505" ? "active-claim" : "claim-failed";
    redirect(`/leagues/${leagueId.data}/claim?error=${code}`);
  }

  revalidatePath(`/leagues/${leagueId.data}/claims`);
  redirect(`/leagues/${leagueId.data}/claim?requested=1`);
}

export async function reviewTeamClaim(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const claimId = uuidSchema.safeParse(formData.get("claimId"));
  const leagueId = uuidSchema.safeParse(formData.get("leagueId"));
  const decision = z
    .enum(["approved", "rejected"])
    .safeParse(formData.get("decision"));

  if (!claimId.success || !leagueId.success || !decision.success) redirect("/");

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    redirect(`/leagues/${leagueId.data}/claims?error=not-configured`);
  }

  const { error } = await admin.rpc("review_team_claim", {
    target_claim: claimId.data,
    reviewer: user.id,
    decision: decision.data,
  });

  if (error) {
    redirect(`/leagues/${leagueId.data}/claims?error=review-failed`);
  }

  revalidatePath(`/leagues/${leagueId.data}`);
  revalidatePath(`/leagues/${leagueId.data}/claims`);
  redirect(`/leagues/${leagueId.data}/claims?updated=1`);
}
