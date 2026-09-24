import Link from "next/link";
export function LeagueNotice({ message }: { message: string }) {
  return (
    <section className="settings-panel">
      <h1>League unavailable</h1>
      <p role="alert">{message}</p>
      <Link className="button secondary" href="/">
        Back to Home
      </Link>
    </section>
  );
}
