import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { signOut } from "@/app/auth/actions";
import { providerAvailability } from "@/lib/fantasy/provider";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: leagues } = await supabase
    .from("leagues")
    .select("id,name,season,sync_status")
    .order("created_at", { ascending: false });

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE YOURSELF AT HOME</p>
          <h1>Settings</h1>
          <p>Your account and league connections.</p>
        </div>
      </div>

      <section className="settings-panel">
        <h2>Your account</h2>
        <p>
          Signed in as <strong>{user.email}</strong>
        </p>
        <form action={signOut}>
          <button className="button secondary">Sign out</button>
        </form>
      </section>

      <section className="settings-panel">
        <div className="section-title">
          <h2>League connections</h2>
          <Link className="button secondary" href="/leagues/new">
            Connect league
          </Link>
        </div>
        {(leagues ?? []).length > 0 && (
          <>
            {(leagues ?? []).map((league) => (
              <Link
                className="settings-row"
                href={`/leagues/${league.id}`}
                key={league.id}
              >
                <div>
                  <strong>{league.name}</strong>
                  <p>{league.season}</p>
                </div>
                <span className="tag">{league.sync_status}</span>
              </Link>
            ))}
          </>
        )}
        {providerAvailability.map((provider) => (
          <div className="settings-row" key={provider.id}>
            <strong>{provider.name}</strong>
            <span className="tag">{provider.label}</span>
          </div>
        ))}
      </section>

      <section className="settings-panel">
        <h2>Notifications</h2>
        <p>
          Not enabled. Web Push opt-in will be available in a later release.
        </p>
      </section>
    </>
  );
}
