import { z } from "zod";
export const uuidSchema = z.uuid();
export const leagueRowSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  season: z.number(),
  commissioner_id: uuidSchema,
  timezone: z.string().default("America/New_York"),
  current_week: z.number().nullable(),
  sync_status: z.enum(["pending", "syncing", "complete", "failed"]),
  last_synced_at: z.string().nullable(),
});
export type LeagueRow = z.infer<typeof leagueRowSchema>;
export const teamRowSchema = z.object({
  id: uuidSchema,
  league_id: uuidSchema,
  external_id: z.string(),
  name: z.string(),
  wins: z.number(),
  losses: z.number(),
  ties: z.number(),
  points_for: z.number(),
  points_against: z.number(),
  active: z.boolean(),
});
export const matchupRowSchema = z.object({
  team_id: uuidSchema,
  opponent_id: uuidSchema.nullable(),
  team_score: z.number().nullable(),
  opponent_score: z.number().nullable(),
  week: z.number(),
  status: z.enum(["scheduled", "live", "final"]),
});
export const claimRowSchema = z.object({
  id: uuidSchema,
  league_id: uuidSchema,
  team_id: uuidSchema,
  requester_id: uuidSchema,
  requester_label: z.string(),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
  reviewer_id: uuidSchema.nullable(),
});
export type ClaimRow = z.infer<typeof claimRowSchema>;
export const claimOptionsSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  season: z.number(),
  teams: z.array(
    z.object({ id: uuidSchema, name: z.string(), available: z.boolean() }),
  ),
});
export type ClaimOptions = z.infer<typeof claimOptionsSchema>;
export class LeagueError extends Error {}
export function databaseError(message: string): LeagueError {
  const known = [
    "Commissioner required",
    "Please wait before syncing again",
    "Sync already running",
    "Import limit reached",
    "Claim already reviewed",
    "Team or manager already assigned",
    "Manager already assigned",
    "Team is no longer active",
    "Invalid team",
    "League unavailable",
    "Pending claim not found",
    "Not eligible",
    "Already voted",
    "Voting is closed",
    "Vote not found",
    "Invalid trade",
    "Results are hidden",
    "Too many attempts",
    "Vote rules are frozen",
    "Privacy cannot change",
    "Identities cannot be published",
    "Ballot cannot be edited",
    "Eligibility is frozen",
    "Invalid subscription",
    "Subscription not found",
    "Invalid recap settings",
    "Invalid recap",
    "Recap not found",
  ];
  if (known.includes(message)) return new LeagueError(message + ".");
  if (message.includes("one_active_claim_per_user"))
    return new LeagueError(
      "You already have a pending or approved claim in this league.",
    );
  if (message.includes("unique constraint"))
    return new LeagueError(
      "That team or manager is already assigned. Refresh and review the current status.",
    );
  return new LeagueError(
    "The request could not be saved. Check that database migrations are applied, then try again.",
  );
}
