// Deliberately fixed, non-sensitive fields. Never pass errors, request bodies, email or credentials.
export function leagueLog(
  event:
    | "sync_started"
    | "sync_complete"
    | "sync_failed"
    | "claim_requested"
    | "claim_reviewed"
    | "vote_published"
    | "ballot_cast"
    | "vote_cancelled"
    | "identities_published"
    | "notification_sent"
    | "notification_failed",
  leagueId: string,
  outcome: "ok" | "provider" | "persistence" = "ok",
) {
  console.info(
    JSON.stringify({ event, leagueId, outcome, at: new Date().toISOString() }),
  );
}
