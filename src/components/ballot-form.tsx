"use client";
import { useActionState } from "react";
import { castBallot } from "@/app/trades/actions";
import { Turnstile } from "@/components/turnstile";

export function BallotForm({
  leagueId,
  voteId,
  siteKey,
}: {
  leagueId: string;
  voteId: string;
  siteKey?: string;
}) {
  const [state, action, pending] = useActionState(castBallot, {});
  return (
    <form action={action} className="ballot-form">
      <input type="hidden" name="leagueId" value={leagueId} />
      <input type="hidden" name="voteId" value={voteId} />
      {siteKey && <Turnstile siteKey={siteKey} attempt={state} />}
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
      {state.receipt && (
        <p role="status" className="success-message">
          {state.message} Receipt <strong>{state.receipt}</strong>
        </p>
      )}
      <div className="choice-row">
        <button className="button" name="choice" value="approve" disabled={pending || Boolean(state.receipt)}>
          Approve
        </button>
        <button
          className="button secondary"
          name="choice"
          value="veto"
          disabled={pending || Boolean(state.receipt)}
        >
          Veto
        </button>
      </div>
    </form>
  );
}
