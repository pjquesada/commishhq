"use client";
import { useActionState } from "react";
import { saveRecapPreferences, type RecapActionState } from "@/app/recaps/actions";

export function RecapSettingsForm({
  leagueId,
  trashTalk,
  profanity,
  adultHumor,
  memeLevel,
  length,
  timezone,
}: {
  leagueId: string;
  trashTalk: string;
  profanity: string;
  adultHumor: boolean;
  memeLevel: string;
  length: string;
  timezone: string;
}) {
  const [state, action, pending] = useActionState<RecapActionState, FormData>(saveRecapPreferences, {});
  return (
    <form action={action} className="stack">
      <input type="hidden" name="leagueId" value={leagueId} />
      <label>
        Trash talk
        <select name="trashTalk" defaultValue={trashTalk}>
          <option value="light">Light</option>
          <option value="normal">Normal</option>
          <option value="savage">Savage</option>
        </select>
      </label>
      <label>
        Profanity
        <select name="profanity" defaultValue={profanity}>
          <option value="clean">Clean</option>
          <option value="some">Some</option>
          <option value="uncensored">Uncensored</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" name="adultHumor" defaultChecked={adultHumor} />
        Adult humor
      </label>
      <label>
        Meme level
        <select name="memeLevel" defaultValue={memeLevel}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="brainrot">Brainrot</option>
        </select>
      </label>
      <label>
        League timezone
        <input name="timezone" defaultValue={timezone} required />
      </label>
      <label>
        Length
        <select name="recapLength" defaultValue={length}>
          <option value="quick">Quick</option>
          <option value="normal">Normal</option>
          <option value="full">Full</option>
        </select>
      </label>
      {state.error && <p role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
      <button className="button" disabled={pending}>
        {pending ? "Saving…" : "Save recap style"}
      </button>
    </form>
  );
}
