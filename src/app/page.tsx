import Link from "next/link";
import {
  ArrowUpRight,
  ArrowLeftRight,
  Newspaper,
  PlugZap,
  ShieldCheck,
} from "lucide-react";
import { currentUser } from "@/lib/auth/session";
import { providerAvailability } from "@/lib/fantasy/provider";
import { LeagueList } from "@/components/league-list";
export default async function Home() {
  const user = await currentUser();
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR LEAGUE. YOUR PEOPLE.</p>
          <h1>
            Welcome to HQ<span className="green">.</span>
          </h1>
          <p>Your commissioner duties just got a little lighter.</p>
        </div>
        <span className="pill">
          <span className="status-dot" /> League workspace
        </span>
      </div>
      {user && <LeagueList />}
      <section className="welcome-panel">
        <div className="welcome-copy">
          <span className="outline-label">LET’S GET YOUR LEAGUE TOGETHER</span>
          <h2>
            Big league energy.
            <br />
            Less commissioner work.
          </h2>
          <p>
            One home for your league’s trade votes and weekly recaps. Built for
            the person who keeps it all running.
          </p>
          <Link className="button light" href="/leagues/new">
            Connect your Sleeper league
            <ArrowUpRight size={18} />
          </Link>
          <small>
            {user
              ? "Your teams and standings, together in one place."
              : "Sign in or create an account to get started."}
          </small>
        </div>
        <div className="field-art" aria-hidden="true">
          <div className="field-line line-one" />
          <div className="field-line line-two" />
          <div className="field-line line-three" />
          <div className="play-circle circle-one">×</div>
          <div className="play-circle circle-two">×</div>
          <div className="play-circle circle-three">○</div>
          <svg viewBox="0 0 300 240">
            <path d="M90 200 V115 Q90 70 135 70 H230 M204 45 L230 70 L204 95" />
          </svg>
          <span className="field-caption">A BETTER GAME PLAN.</span>
        </div>
      </section>
      <section className="setup-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">FIRST THINGS FIRST</p>
            <h2>Your league starts here</h2>
          </div>
          <span className="muted">01 / 02</span>
        </div>
        <div className="setup-steps">
          <div className="setup-step">
            <span className="step-number">{user ? "✓" : "01"}</span>
            <div>
              <h3>{user ? "Account ready" : "Make it official"}</h3>
              <p>
                {user
                  ? "Your commissioner workspace is ready."
                  : "Create your account and give your league a home."}
              </p>
            </div>
            <Link
              href={user ? "/settings" : "/login"}
              aria-label={user ? "View account" : "Create an account"}
            >
              <ArrowUpRight size={22} />
            </Link>
          </div>
          <div className="setup-step next-step">
            <span className="step-number">02</span>
            <div>
              <h3>Bring your league</h3>
              <p>Connect your existing league. Keep playing where you play.</p>
            </div>
            <Link className="tag" href="/leagues/new">
              Connect now ↗
            </Link>
          </div>
        </div>
      </section>
      <section className="providers">
        <div>
          <PlugZap size={19} />
          <strong>Your league, connected.</strong>
        </div>
        <div className="provider-list">
          {providerAvailability.map((p) => (
            <div key={p.id}>
              <span>{p.name}</span>
              <small>
                {p.id === "sleeper" ? (
                  <Link href="/leagues/new">{p.label} ↗</Link>
                ) : (
                  p.label
                )}
              </small>
            </div>
          ))}
        </div>
      </section>
      <div className="section-title coming-title">
        <h2>A better week for everyone</h2>
        <span className="eyebrow">COMING TO YOUR HQ</span>
      </div>
      <div className="feature-grid">
        <Link href="/trades" className="feature">
          <span className="feature-icon">
            <ArrowLeftRight size={22} />
          </span>
          <h3>Fair trades. Clear decisions.</h3>
          <p>
            One team, one vote. Private ballots and a clear deadline keep league
            decisions fair.
          </p>
          <span className="feature-link">
            Trade votes <ArrowUpRight size={16} />
          </span>
        </Link>
        <Link href="/recaps" className="feature">
          <span className="feature-icon peach">
            <Newspaper size={22} />
          </span>
          <h3>The week deserves a recap.</h3>
          <p>
            The blowouts. The lucky wins. The bench disasters. Your league’s
            story, with personality.
          </p>
          <span className="feature-link">
            Weekly recaps <ArrowUpRight size={16} />
          </span>
        </Link>
      </div>
      <div className="quiet-note">
        <ShieldCheck size={16} />
        <span>
          Your fantasy platform runs the games. CommishHQ brings the league
          together.
        </span>
      </div>
    </>
  );
}
