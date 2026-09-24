"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, ArrowLeftRight, Newspaper, Settings } from "lucide-react";
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
          aria-current={
            pathname === href ||
            (href === "/" && pathname.startsWith("/leagues/"))
              ? "page"
              : undefined
          }
        >
          <Icon size={19} strokeWidth={1.7} />
          <span>{name}</span>
        </Link>
      ))}
    </nav>
  );
}
