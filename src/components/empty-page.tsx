import Link from "next/link";
import { ArrowLeftRight, Newspaper } from "lucide-react";
export function EmptyPage({ kind }: { kind: "trades" | "recaps" }) {
  const trades = kind === "trades";
  const Icon = trades ? ArrowLeftRight : Newspaper;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE COMMISSIONER’S CORNER</p>
          <h1>{trades ? "Trade votes" : "Weekly recaps"}</h1>
          <p>
            {trades
              ? "A fair say for every eligible team."
              : "Your league’s week, with a little personality."}
          </p>
        </div>
      </div>
      <section className="empty-state">
        <span className="feature-icon">
          <Icon size={30} />
        </span>
        <span className="tag">Coming soon</span>
        <h2>
          {trades
            ? "Good trades deserve a fair vote."
            : "Every matchup has a story."}
        </h2>
        <p>
          {trades
            ? "Secure league voting is coming in Phase 3. Ballot choices will stay hidden until voting closes."
            : "Personalized weekly recaps are coming in Phase 5. Grounded in your actual matchups."}
        </p>
        <Link className="button" href="/">
          Back to Home <span>→</span>
        </Link>
      </section>
    </>
  );
}
