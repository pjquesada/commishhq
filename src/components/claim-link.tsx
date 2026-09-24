"use client";
import { useState } from "react";
export function ClaimLink({ leagueId }: { leagueId: string }) {
  const path = `/leagues/${leagueId}/claim`;
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        new URL(path, window.location.origin).href,
      );
      setStatus("Claim link copied.");
    } catch {
      setStatus("Open the claim page and copy its address to share.");
    }
  }
  return (
    <div className="claim-link">
      <a href={path}>Open team-claim page ↗</a>
      <button className="button secondary" onClick={copy}>
        Copy claim link
      </button>
      <p role="status">{status}</p>
      <small>
        Only share with your league. The link lets managers request a team; it
        never approves a claim.
      </small>
    </div>
  );
}
