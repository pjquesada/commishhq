import { AuthForm } from "@/components/auth-form";
import { publicEnv } from "@/lib/env";
export const metadata = { title: "Sign in" };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <section className="auth-panel">
      <p className="eyebrow">WELCOME TO THE LEAGUE</p>
      <h1>Your seat at HQ.</h1>
      <p>Sign in to your commissioner workspace.</p>
      {error && (
        <p role="alert">
          That confirmation link could not be verified. Request a new link by
          signing up again, or sign in if already confirmed.
        </p>
      )}
      {publicEnv().success ? (
        <AuthForm />
      ) : (
        <div className="setup-notice">
          <h2>Account setup is on its way.</h2>
          <p>
            This workspace needs its Supabase connection before you can create
            an account. Follow the local setup instructions in the project
            README.
          </p>
        </div>
      )}
    </section>
  );
}
