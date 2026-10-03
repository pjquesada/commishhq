"use client";
import { useRef, useState } from "react";
import { useActionState } from "react";
import { savePushSubscription } from "@/app/push/actions";

export function PushSettings({ publicKey }: { publicKey?: string }) {
  const [state, action, pending] = useActionState(savePushSubscription, {});
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  async function enable() {
    setError("");
    if (!publicKey || !formRef.current || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setError("This browser cannot receive push notifications.");
      return;
    }
    try {
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      const padded = publicKey.replace(/-/g, "+").replace(/_/g, "/");
      const key = Uint8Array.from(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)), (char) =>
        char.charCodeAt(0),
      );
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      const json = subscription.toJSON();
      const data = new FormData(formRef.current);
      data.set("endpoint", subscription.endpoint);
      data.set("p256dh", json.keys?.p256dh ?? "");
      data.set("auth", json.keys?.auth ?? "");
      data.set("agent", navigator.userAgent.slice(0, 120));
      formRef.current.querySelectorAll("input").forEach((input) => {
        const value = data.get(input.name);
        if (typeof value === "string") input.value = value;
      });
      formRef.current.requestSubmit();
    } catch {
      setError("Push permission was not granted.");
    }
  }
  return (
    <div>
      <p>
        On iPhone or iPad, add CommishHQ to the Home Screen before enabling push. Safari delivers
        Web Push to installed Home Screen apps.
      </p>
      {!publicKey && <p>Push is not configured on this server yet.</p>}
      <form ref={formRef} action={action}>
        <input type="hidden" name="endpoint" />
        <input type="hidden" name="p256dh" />
        <input type="hidden" name="auth" />
        <input type="hidden" name="agent" />
      </form>
      {publicKey && (
        <button className="button" type="button" onClick={() => void enable()} disabled={pending}>
          {pending ? "Enabling…" : "Enable push on this device"}
        </button>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
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
    </div>
  );
}
