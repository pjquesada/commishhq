import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Pwa } from "@/components/pwa";
import { currentUser } from "@/lib/auth/session";
import "./globals.css";
// Session-dependent pages must never be prerendered, even during credential-free builds.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: {
    default: "CommishHQ — Your league, handled.",
    template: "%s · CommishHQ",
  },
  description:
    "A little less commissioner work. A lot more league personality.",
  appleWebApp: { capable: true, title: "CommishHQ", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = {
  themeColor: "#153e35",
  width: "device-width",
  initialScale: 1,
};
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className="app-layout">
          <aside className="sidebar">
            <Link href="/" className="brand">
              <span className="brand-mark">
                C<span>H</span>
              </span>
              <span>
                commish<span className="brand-hq">HQ</span>
                <small>THE COMMISSIONER’S CORNER</small>
              </span>
            </Link>
            <div className="sidebar-label">YOUR WORKSPACE</div>
            <Navigation />
            <div className="sidebar-note">
              <ShieldCheck size={21} />
              <strong>
                Good leagues deserve
                <br />a great commissioner.
              </strong>
              <p>We’ll handle the busywork.</p>
            </div>
            <div className="sidebar-footer">
              <span className="status-dot" /> EARLY ACCESS <span>v0.1</span>
            </div>
          </aside>
          <div className="workspace">
            <header className="topbar">
              <span>
                Fantasy football <span className="slash">/</span> Commissioner
                HQ
              </span>
              <Link
                href={user ? "/settings" : "/login"}
                className="account-link"
              >
                <span className="avatar">
                  {user ? (user.email?.[0] ?? "M").toUpperCase() : "↗"}
                </span>
                {user ? "My account" : "Sign in"}
              </Link>
            </header>
            <main id="main">{children}</main>
            <footer className="main-footer">
              <span>Less admin. More football.</span>
              <span>CommishHQ · Made for your league</span>
            </footer>
          </div>
        </div>
        <Pwa />
      </body>
    </html>
  );
}
