"use client";
import { useActionState } from "react";
import {
  cancelTradeVote,
  publishIdentities,
  saveVotePreferences,
  type TradeActionState,
} from "@/app/trades/actions";

function Feedback({ state }: { state: TradeActionState }) {
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

export function CancelVoteForm({ leagueId, voteId }: { leagueId: string; voteId: string }) {
  const [state, action, pending] = useActionState(cancelTradeVote, {});
  return (
    <form action={action}>
      <input type="hidden" name="leagueId" value={leagueId} />
      <input type="hidden" name="voteId" value={voteId} />
      <button className="button secondary" disabled={pending}>
        {pending ? "Cancelling…" : "Cancel vote"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function PublishIdentitiesForm({ leagueId, voteId }: { leagueId: string; voteId: string }) {
  const [state, action, pending] = useActionState(publishIdentities, {});
  return (
    <form action={action}>
      <input type="hidden" name="leagueId" value={leagueId} />
      <input type="hidden" name="voteId" value={voteId} />
      <button className="button secondary" disabled={pending}>
        {pending ? "Publishing…" : "Publish voter identities"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function VotePreferencesForm({
  leagueId,
  participantsMayVote,
  defaultVoteHours,
}: {
  leagueId: string;
  participantsMayVote: boolean;
  defaultVoteHours: number;
}) {
  const [state, action, pending] = useActionState(saveVotePreferences, {});
  return (
    <form action={action} className="auth-form">
      <input type="hidden" name="leagueId" value={leagueId} />
      <label className="check-row">
        <input type="checkbox" name="participantsMayVote" defaultChecked={participantsMayVote} />
        Participants may vote on their own trade
      </label>
      <label>
        Default vote duration (hours)
        <input
          name="defaultVoteHours"
          type="number"
          min={1}
          max={168}
          required
          defaultValue={defaultVoteHours}
        />
      </label>
      <p>The veto threshold is chosen on each vote, then frozen when it opens.</p>
      <Feedback state={state} />
      <button className="button" disabled={pending}>
        {pending ? "Saving…" : "Save voting defaults"}
      </button>
    </form>
  );
}
