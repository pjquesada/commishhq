import { requireUser } from "@/lib/auth/session";
import { importSleeperLeague } from "@/app/leagues/actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Connect a league" };

const errors: Record<string, string> = {
  invalid: "Enter a valid Sleeper League ID.",
  not_found: "That Sleeper league could not be found.",
  timeout: "Sleeper took too long to respond. Try again.",
  provider_unavailable: "Sleeper is temporarily unavailable. Try again later.",
  malformed_response: "Sleeper returned data CommishHQ could not validate.",
  already_connected:
    "That league is already connected by another CommishHQ commissioner.",
  not_configured:
    "League importing needs the server-side Supabase secret configured first.",
  database: "CommishHQ could not save the league. Try again.",
  unexpected: "Something went wrong while importing the league.",
};

export default async function NewLeague({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUser();
  const { error } = await searchParams;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CONNECT YOUR LEAGUE</p>
          <h1>Bring the league to HQ.</h1>
          <p>Sleeper is available now. Yahoo and ESPN are coming later.</p>
        </div>
      </div>

      <section className="settings-panel">
        <h2>Sleeper</h2>
        <p>
          Paste the League ID from Sleeper. CommishHQ imports teams, managers,
          standings, and the current week&apos;s matchups.
        </p>
        <form action={importSleeperLeague} className="auth-form">
          <label>
            Sleeper League ID
            <input
              name="leagueId"
              inputMode="numeric"
              autoComplete="off"
              placeholder="1397672371120267264"
              required
              maxLength={30}
            />
          </label>
          {error && (
            <p role="alert" className="form-error">
              {errors[error] ?? errors.unexpected}
            </p>
          )}
          <SubmitButton pendingLabel="Importing from Sleeper…">
            Import league
          </SubmitButton>
        </form>
      </section>

      <section className="settings-panel">
        <div className="settings-row">
          <strong>Yahoo Fantasy</strong>
          <span className="tag">Coming Soon</span>
        </div>
        <div className="settings-row">
          <strong>ESPN Fantasy</strong>
          <span className="tag">Coming Soon</span>
        </div>
      </section>
    </>
  );
}
