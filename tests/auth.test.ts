import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
import { authenticate, signOut } from "@/app/auth/actions";
function form(mode = "login") {
  const values = new FormData();
  values.set("mode", mode);
  values.set("email", "manager@example.com");
  values.set("password", "secure password 123");
  return values;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
  vi.stubEnv("APP_URL", "https://commish.example");
});
describe("server authentication boundary", () => {
  it("fails closed when configuration is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect((await authenticate({}, form())).error).toBeDefined();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it("rejects malformed input before contacting auth", async () => {
    const input = form();
    input.set("email", "invalid");
    expect((await authenticate({}, input)).error).toBeDefined();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it("requires a CAPTCHA token when enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    expect((await authenticate({}, form())).error).toContain("security check");
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it("delegates CAPTCHA validation to Supabase and hides detailed failures", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    auth.signInWithPassword.mockResolvedValue({
      error: { message: "sensitive internal error" },
    });
    const input = form();
    input.set("cf-turnstile-response", "test-token");
    const result = await authenticate({}, input);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "manager@example.com",
      password: "secure password 123",
      options: { captchaToken: "test-token" },
    });
    expect(result.error).toContain("Unable to sign in");
    expect(result.error).not.toContain("sensitive");
  });
  it("redirects only after successful sign-in", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(authenticate({}, form())).rejects.toThrow("REDIRECT:/");
  });
  it("preserves safe claim destinations through sign-in and signup", async () => {
    const destination = "/leagues/10000000-0000-4000-8000-000000000001/claim";
    const login = form();
    login.set("next", destination);
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(authenticate({}, login)).rejects.toThrow(
      `REDIRECT:${destination}`,
    );
    const signup = form("signup");
    signup.set("next", destination);
    auth.signUp.mockResolvedValue({ error: null });
    await authenticate({}, signup);
    expect(
      new URL(
        auth.signUp.mock.calls[0]?.[0].options.emailRedirectTo,
      ).searchParams.get("next"),
    ).toBe(destination);
  });
  it("uses a configured confirmation destination and generic signup response", async () => {
    auth.signUp.mockResolvedValue({ error: null });
    const result = await authenticate({}, form("signup"));
    expect(result.message).toContain("Check your email");
    expect(auth.signUp.mock.calls[0]?.[0].options.emailRedirectTo).toBe(
      "https://commish.example/auth/callback",
    );
  });
  it("does not report successful logout if revocation fails", async () => {
    auth.signOut.mockResolvedValue({ error: { message: "network" } });
    await expect(signOut()).rejects.toThrow("Could not sign out");
  });
});
