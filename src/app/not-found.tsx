import Link from "next/link";
export default function NotFound() {
  return (
    <section className="empty-state">
      <p className="eyebrow">OUT OF BOUNDS</p>
      <h1>Page not found.</h1>
      <Link className="button" href="/">
        Back to Home
      </Link>
    </section>
  );
}
