"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
type TurnstileApi = {
  render: (element: HTMLElement, options: { sitekey: string }) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}
/** Explicit rendering also handles revisiting login through client navigation. */
export function Turnstile({
  siteKey,
  attempt,
}: {
  siteKey: string;
  attempt: object;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ready || !container.current || !window.turnstile) return;
    widget.current = window.turnstile.render(container.current, {
      sitekey: siteKey,
    });
    return () => {
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [ready, siteKey]);
  useEffect(() => {
    if (widget.current) window.turnstile?.reset(widget.current);
  }, [attempt]);
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={() => setReady(true)}
      />
      <div ref={container} />
    </>
  );
}
