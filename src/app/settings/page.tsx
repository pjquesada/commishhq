import { requireUser } from "@/lib/auth/session";
import { signOut } from "@/app/auth/actions";
import { providerAvailability } from "@/lib/fantasy/provider";
export const metadata = { title: "Settings" };
export default async function Settings() {
  const user = await requireUser();
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
        <h2>League connections</h2>
        <p>
          League importing is coming next. Yahoo and ESPN will follow Sleeper.
        </p>
        {providerAvailability.map((p) => (
          <div className="settings-row" key={p.id}>
            <strong>{p.name}</strong>
            <span className="tag">{p.label}</span>
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
