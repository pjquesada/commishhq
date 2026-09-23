"use client";
import { useEffect } from "react";
export function Pwa() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* Online use remains available if installation fails. */
      });
    }
  }, []);
  return null;
}
