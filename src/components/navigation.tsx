"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, ArrowLeftRight, Newspaper, Settings } from "lucide-react";
function currentNav(pathname: string, href: string) {
  if (href === "/trades")
    return pathname === "/trades" || pathname.includes("/trades");
  if (href === "/recaps")
    return pathname === "/recaps" || pathname.includes("/recaps");
  if (href === "/settings") return pathname.startsWith("/settings");
  if (href === "/")
    return (
      pathname === "/" ||
      (pathname.startsWith("/leagues/") &&
        !pathname.includes("/trades") &&
        !pathname.includes("/recaps"))
    );
  return pathname === href;
}
const items = [
  { href: "/", name: "Home", icon: House },
  { href: "/trades", name: "Trades", icon: ArrowLeftRight },
  { href: "/recaps", name: "Recaps", icon: Newspaper },
  { href: "/settings", name: "Settings", icon: Settings },
];
export function Navigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation">
      {items.map(({ href, name, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={currentNav(pathname, href) ? "page" : undefined}
        >
          <Icon size={19} strokeWidth={1.7} />
          <span>{name}</span>
        </Link>
      ))}
    </nav>
  );
}
