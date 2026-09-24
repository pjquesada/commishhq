import { requireUser } from "@/lib/auth/session";
import { adminConfigured } from "@/lib/supabase/admin";
import { ImportForm } from "@/components/league-forms";
export const metadata = { title: "Connect Sleeper" };
export default async function NewLeague() {
  await requireUser("/leagues/new");
  return (
    <section className="auth-panel">
      <p className="eyebrow">BRING YOUR LEAGUE</p>
      <h1>Connect Sleeper.</h1>
      <p>Import your teams, managers, standings and this week’s matchups.</p>
      {adminConfigured() ? (
        <ImportForm />
      ) : (
        <div className="setup-notice">
          <h2>One setup step remains.</h2>
          <p>
            Add SUPABASE_SECRET_KEY to the server environment and apply the
            Phase 2 database migration. Never put this secret in a NEXT_PUBLIC
            variable. Full instructions are in the project README.
          </p>
        </div>
      )}
    </section>
  );
}
