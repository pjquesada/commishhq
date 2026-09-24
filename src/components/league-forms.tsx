"use client";
import { useActionState } from "react";
import {
  importLeague,
  resyncLeague,
  requestClaim,
  reviewClaim,
  cancelClaim,
  type LeagueActionState,
} from "@/app/leagues/actions";
import type { ClaimOptions } from "@/lib/leagues/models";
function Feedback({ state }: { state: LeagueActionState }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="success-message">
          {state.message}
        </p>
      )}
    </>
  );
}
export function ImportForm() {
  const [state, action, pending] = useActionState(importLeague, {});
  return (
    <form action={action} className="auth-form">
      <label>
        Sleeper League ID
        <input
          name="externalId"
          required
          inputMode="numeric"
          pattern="[0-9]{1,30}"
          maxLength={30}
          placeholder="e.g. 1234567890123456789"
        />
        <small>Copy the number from your Sleeper league’s URL.</small>
      </label>
      <p>
        You’ll become this league’s CommishHQ commissioner if it hasn’t been
        imported. This does not verify that you own it on Sleeper.
      </p>
      <Feedback state={state} />
      <button className="button" disabled={pending}>
        {pending ? "Importing league…" : "Import Sleeper league"}
      </button>
    </form>
  );
}
export function SyncForm({
  leagueId,
  configured,
}: {
  leagueId: string;
  configured: boolean;
}) {
  const [state, action, pending] = useActionState(resyncLeague, {});
  return (
    <form action={action}>
      <input type="hidden" name="leagueId" value={leagueId} />
      <button className="button secondary" disabled={pending || !configured}>
        {pending ? "Refreshing…" : "Refresh league"}
      </button>
      <Feedback state={state} />
      {!configured && (
        <p>
          League refresh needs server configuration. See the project README.
        </p>
      )}
    </form>
  );
}
export function ClaimForm({ options }: { options: ClaimOptions }) {
  const [state, action, pending] = useActionState(requestClaim, {});
  return (
    <form action={action} className="auth-form">
      <input type="hidden" name="leagueId" value={options.id} />
      <label>
        Your team
        <select name="teamId" required defaultValue="">
          <option value="" disabled>
            Choose your team
          </option>
          {options.teams.map((team) => (
            <option value={team.id} key={team.id} disabled={!team.available}>
              {team.name}
              {team.available ? "" : " — already assigned"}
            </option>
          ))}
        </select>
      </label>
      <p>
        A request gives you no league access or team authority. Your
        commissioner must confirm your identity and approve it.
      </p>
      <Feedback state={state} />
      <button
        className="button"
        disabled={pending || !options.teams.some((t) => t.available)}
      >
        {pending ? "Sending…" : "Request this team"}
      </button>
    </form>
  );
}
export function ReviewForm({
  leagueId,
  claimId,
}: {
  leagueId: string;
  claimId: string;
}) {
  const [state, action, pending] = useActionState(reviewClaim, {});
  return (
    <form action={action}>
      <input type="hidden" name="leagueId" value={leagueId} />
      <input type="hidden" name="claimId" value={claimId} />
      <div className="action-row">
        <button
          className="button"
          name="decision"
          value="approved"
          disabled={pending}
        >
          Approve
        </button>
        <button
          className="button secondary"
          name="decision"
          value="rejected"
          disabled={pending}
        >
          Reject
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
export function CancelClaimForm({
  leagueId,
  claimId,
}: {
  leagueId: string;
  claimId: string;
}) {
  const [state, action, pending] = useActionState(cancelClaim, {});
  return (
    <form action={action}>
      <input type="hidden" name="leagueId" value={leagueId} />
      <input type="hidden" name="claimId" value={claimId} />
      <button className="text-button" disabled={pending}>
        Cancel request
      </button>
      <Feedback state={state} />
    </form>
  );
}
