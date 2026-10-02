"use client";
import { useState } from "react";
import { useActionState } from "react";
import { publishTradeVote, type TradeActionState } from "@/app/trades/actions";

type Team = { id: string; name: string };
const assetTypes = [
  ["player", "Player"],
  ["draft_pick", "Draft pick"],
  ["faab", "FAAB"],
  ["custom", "Custom"],
] as const;

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

export function TradeVoteForm({
  leagueId,
  teams,
  timezone,
  participantsMayVote,
  defaultDeadline,
}: {
  leagueId: string;
  teams: Team[];
  timezone: string;
  participantsMayVote: boolean;
  defaultDeadline: string;
}) {
  const [state, action, pending] = useActionState(publishTradeVote, {});
  const [traders, setTraders] = useState<string[]>([]);
  const [assets, setAssets] = useState<Record<string, { type: string; label: string }[]>>({});
  const [eligible, setEligible] = useState<string[]>(teams.map((team) => team.id));
  const [participants, setParticipants] = useState(participantsMayVote);
  function toggleTrader(id: string) {
    const next = traders.includes(id)
      ? traders.filter((item) => item !== id)
      : [...traders, id];
    setTraders(next);
    if (!participants)
      setEligible(teams.map((team) => team.id).filter((teamId) => !next.includes(teamId)));
    setAssets((current) => ({
      ...current,
      [id]: current[id]?.length ? current[id] : [{ type: "player", label: "" }],
    }));
  }
  const sides = traders.map((teamId) => ({
    team_id: teamId,
    assets: (assets[teamId] ?? []).filter((asset) => asset.label.trim()),
  }));
  const vetoDefault = Math.max(1, Math.ceil(eligible.length / 2));
  return (
    <form action={action} className="auth-form">
      <input type="hidden" name="leagueId" value={leagueId} />
      <input type="hidden" name="sides" value={JSON.stringify(sides)} />
      <input type="hidden" name="eligible" value={JSON.stringify(eligible)} />
      <fieldset>
        <legend>Trading teams</legend>
        {teams.map((team) => (
          <label key={team.id} className="check-row">
            <input
              type="checkbox"
              checked={traders.includes(team.id)}
              onChange={() => toggleTrader(team.id)}
            />
            {team.name}
          </label>
        ))}
      </fieldset>
      {traders.map((teamId) => (
        <fieldset key={teamId}>
          <legend>{teams.find((team) => team.id === teamId)?.name} receives</legend>
          {(assets[teamId] ?? []).map((asset, index) => (
            <div className="asset-row" key={`${teamId}-${index}`}>
              <label>
                Type
                <select
                  value={asset.type}
                  onChange={(event) =>
                    setAssets((current) => ({
                      ...current,
                      [teamId]: (current[teamId] ?? []).map((item, itemIndex) =>
                        itemIndex === index ? { ...item, type: event.target.value } : item,
                      ),
                    }))
                  }
                >
                  {assetTypes.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Label
                <input
                  value={asset.label}
                  maxLength={120}
                  required
                  onChange={(event) =>
                    setAssets((current) => ({
                      ...current,
                      [teamId]: (current[teamId] ?? []).map((item, itemIndex) =>
                        itemIndex === index ? { ...item, label: event.target.value } : item,
                      ),
                    }))
                  }
                />
              </label>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              setAssets((current) => ({
                ...current,
                [teamId]: [...(current[teamId] ?? []), { type: "player", label: "" }],
              }))
            }
          >
            Add asset
          </button>
        </fieldset>
      ))}
      <label>
        Deadline ({timezone})
        <input type="datetime-local" name="deadline" required defaultValue={defaultDeadline} />
        <small>Interpreted in the league timezone, not only this device.</small>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          name="participantsMayVote"
          checked={participants}
          onChange={(event) => {
            const next = event.target.checked;
            setParticipants(next);
            if (!next) setEligible(teams.map((team) => team.id).filter((id) => !traders.includes(id)));
          }}
        />
        Teams in the trade may vote
      </label>
      <fieldset>
        <legend>Eligible voting teams</legend>
        {teams.map((team) => (
          <label key={team.id} className="check-row">
            <input
              type="checkbox"
              checked={eligible.includes(team.id)}
              disabled={!participants && traders.includes(team.id)}
              onChange={() =>
                setEligible((current) =>
                  current.includes(team.id)
                    ? current.filter((id) => id !== team.id)
                    : [...current, team.id],
                )
              }
            />
            {team.name}
          </label>
        ))}
      </fieldset>
      <label>
        Vetoes required
        <input
          name="requiredVetoVotes"
          type="number"
          min={1}
          max={eligible.length || 1}
          defaultValue={vetoDefault}
          key={vetoDefault}
        />
        <small>Default is half of the eligible teams, rounded up. Frozen once voting opens.</small>
      </label>
      <fieldset>
        <legend>Ballot privacy</legend>
        <label className="check-row">
          <input type="radio" name="privacyMode" value="anonymous" defaultChecked />
          Anonymous. Totals after the deadline. Choices are never tied to a team.
        </label>
        <label className="check-row">
          <input type="radio" name="privacyMode" value="commissioner_may_reveal_after_close" />
          The commissioner may publish individual choices after the deadline. Voters see this before they vote.
        </label>
      </fieldset>
      <Feedback state={state} />
      <button className="button" disabled={pending}>
        {pending ? "Opening vote…" : "Open trade vote"}
      </button>
    </form>
  );
}
