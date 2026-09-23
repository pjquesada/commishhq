"use client";
import { useActionState, useState } from "react";
import { Turnstile } from "@/components/turnstile";
import { authenticate } from "@/app/auth/actions";
export function AuthForm() {
  const [state, action, pending] = useActionState(authenticate, {});
  const [signup, setSignup] = useState(false);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return (
    <form action={action} className="auth-form">
      <input type="hidden" name="mode" value={signup ? "signup" : "login"} />
      <label>
        Email address
        <input
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          maxLength={254}
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          required
          minLength={12}
          maxLength={128}
        />
        <small>At least 12 characters.</small>
      </label>
      {siteKey && <Turnstile siteKey={siteKey} attempt={state} />}
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
      {state.message && <p role="status">{state.message}</p>}
      <button className="button" disabled={pending}>
        {pending ? "Please wait…" : signup ? "Create account" : "Sign in"}
        <span aria-hidden="true">→</span>
      </button>
      <button
        type="button"
        className="text-button"
        onClick={() => setSignup(!signup)}
      >
        {signup ? "Already a member? Sign in" : "New here? Create an account"}
      </button>
    </form>
  );
}
