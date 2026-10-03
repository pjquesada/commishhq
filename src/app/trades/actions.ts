"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { databaseError, LeagueError, uuidSchema } from "@/lib/leagues/models";
import { leagueLog } from "@/lib/leagues/log";
import { tradePayloadSchema } from "@/lib/trades/payload";
import { zonedLocalToUtc } from "@/lib/time";
import { verifyTurnstile } from "@/lib/security/turnstile";

export type TradeActionState = { error?: string; message?: string; receipt?: string };

function failure(error: unknown): TradeActionState {
  return {
    error:
      error instanceof LeagueError
        ? error.message
        : "This request could not be completed. Try again.",
  };
}

export async function publishTradeVote(
  _state: TradeActionState,
  form: FormData,
): Promise<TradeActionState> {
  await requireUser();
  const leagueId = uuidSchema.safeParse(form.get("leagueId"));
  if (!leagueId.success) return { error: "Invalid league." };
  let sidesJson: unknown = [];
  let eligibleJson: unknown = [];
  try {
    sidesJson = JSON.parse(String(form.get("sides") ?? "[]"));
    eligibleJson = JSON.parse(String(form.get("eligible") ?? "[]"));
  } catch {
    return { error: "Check the teams and assets." };
  }
  const teams = z
    .array(
      z.object({
        team_id: uuidSchema,
        assets: z.array(
          z.object({
            type: z.enum(["player", "draft_pick", "faab", "custom"]),
            label: z.string(),
          }),
        ),
      }),
    )
    .safeParse(sidesJson);
  const eligible = z.array(uuidSchema).safeParse(eligibleJson);
  if (!teams.success || !eligible.success) return { error: "Check the teams and assets." };
  const vetoRaw = String(form.get("requiredVetoVotes") ?? "").trim();
  const client = await createClient();
  const league = await client
    .from("leagues")
    .select("timezone,commissioner_id")
    .eq("id", leagueId.data)
    .maybeSingle();
  if (league.error) return failure(databaseError(league.error.message));
  if (!league.data) return { error: "League not found or access not approved." };
  let closes: Date;
  try {
    closes = zonedLocalToUtc(String(form.get("deadline") ?? ""), String(league.data.timezone));
  } catch {
    return { error: "Enter a valid deadline." };
  }
  const payload = tradePayloadSchema.safeParse({
    league_id: leagueId.data,
    privacy_mode: form.get("privacyMode"),
    participants_may_vote: form.get("participantsMayVote") === "on",
    closes_at: closes.toISOString(),
    required_veto_votes: vetoRaw ? Number(vetoRaw) : undefined,
    sides: teams.data,
    eligible_team_ids: eligible.data,
  });
  if (!payload.success) return { error: "Check the trade, deadline, and voting rules." };
  const result = await client.rpc("publish_trade_vote", { payload: payload.data });
  if (result.error) return failure(databaseError(result.error.message));
  const voteId = uuidSchema.parse(result.data);
  leagueLog("vote_published", leagueId.data);
  try {
    const { deliverPending } = await import("@/lib/push/delivery");
    await deliverPending(5);
  } catch {
    /* The outbox remains pending for the scheduled worker. */
  }
  revalidatePath("/trades");
  revalidatePath(`/leagues/${leagueId.data}/trades/${voteId}`);
  redirect(`/leagues/${leagueId.data}/trades/${voteId}`);
}

export async function castBallot(
  _state: TradeActionState,
  form: FormData,
): Promise<TradeActionState> {
  await requireUser();
  const leagueId = uuidSchema.safeParse(form.get("leagueId"));
  const voteId = uuidSchema.safeParse(form.get("voteId"));
  const choice = form.get("choice");
  if (!leagueId.success || !voteId.success || (choice !== "approve" && choice !== "veto"))
    return { error: "Invalid ballot." };
  if (!(await verifyTurnstile(form.get("cf-turnstile-response"))))
    return { error: "Complete the security check, then submit the ballot again." };
  const client = await createClient();
  const vote = await client
    .from("trade_votes")
    .select("id")
    .eq("id", voteId.data)
    .eq("league_id", leagueId.data)
    .maybeSingle();
  if (vote.error) return failure(databaseError(vote.error.message));
  if (!vote.data) return { error: "Vote not found." };
  const result = await client.rpc("cast_trade_ballot", {
    target_vote: voteId.data,
    ballot_choice: choice,
  });
  if (result.error) return failure(databaseError(result.error.message));
  leagueLog("ballot_cast", leagueId.data);
  revalidatePath("/trades");
  revalidatePath(`/leagues/${leagueId.data}/trades/${voteId.data}`);
  return {
    receipt: z.string().parse(result.data),
    message: "Ballot accepted. Save the receipt. It does not reveal your choice.",
  };
}

export async function cancelTradeVote(
  _state: TradeActionState,
  form: FormData,
): Promise<TradeActionState> {
  await requireUser();
  const leagueId = uuidSchema.safeParse(form.get("leagueId"));
  const voteId = uuidSchema.safeParse(form.get("voteId"));
  if (!leagueId.success || !voteId.success) return { error: "Invalid vote." };
  const client = await createClient();
  const result = await client.rpc("cancel_trade_vote", { target_vote: voteId.data });
  if (result.error) return failure(databaseError(result.error.message));
  leagueLog("vote_cancelled", leagueId.data);
  revalidatePath("/trades");
  revalidatePath(`/leagues/${leagueId.data}/trades/${voteId.data}`);
  return { message: "Vote cancelled. The audit history is unchanged." };
}

export async function publishIdentities(
  _state: TradeActionState,
  form: FormData,
): Promise<TradeActionState> {
  await requireUser();
  const leagueId = uuidSchema.safeParse(form.get("leagueId"));
  const voteId = uuidSchema.safeParse(form.get("voteId"));
  if (!leagueId.success || !voteId.success) return { error: "Invalid vote." };
  const client = await createClient();
  const result = await client.rpc("publish_vote_identities", { target_vote: voteId.data });
  if (result.error) return failure(databaseError(result.error.message));
  leagueLog("identities_published", leagueId.data);
  revalidatePath(`/leagues/${leagueId.data}/trades/${voteId.data}`);
  return { message: "Voter identities are now visible to the league." };
}

export async function saveVotePreferences(
  _state: TradeActionState,
  form: FormData,
): Promise<TradeActionState> {
  await requireUser("/settings");
  const leagueId = uuidSchema.safeParse(form.get("leagueId"));
  const hours = Number(form.get("defaultVoteHours"));
  if (!leagueId.success || !Number.isInteger(hours)) return { error: "Invalid voting defaults." };
  const client = await createClient();
  const result = await client.rpc("update_league_preferences", {
    target: leagueId.data,
    prefs: {
      participants_may_vote: form.get("participantsMayVote") === "on",
      default_vote_hours: hours,
    },
  });
  if (result.error) return failure(databaseError(result.error.message));
  revalidatePath("/settings");
  return { message: "Voting defaults saved." };
}
