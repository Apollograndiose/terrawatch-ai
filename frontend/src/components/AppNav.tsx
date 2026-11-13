"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Activity, BarChart3, BookOpen, BrainCircuit, Flame, Waves } from "lucide-react";

const LINKS = [
  { href: "/", label: "Wildfire", icon: Flame },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/flood", label: "Flood", icon: Waves },
  { href: "/model", label: "Model", icon: BrainCircuit },
  { href: "/about", label: "Methods & Data", icon: BookOpen },
];

export function AppNav() {
  const path = usePathname();
  return (
    <header className="z-30 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface-0/95 px-3 backdrop-blur sm:px-4">
      <Link href="/" className="flex items-center gap-2 pr-2" aria-label="TerraWatch AI home">
        <Logo />
        <span className="hidden text-[13px] font-semibold tracking-wide sm:inline">
          TerraWatch <span className="text-accent">AI</span>
        </span>
      </Link>
      <nav aria-label="Primary" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" || path.startsWith("/compare") : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors",
                active ? "bg-surface-3 text-text" : "text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              <Icon size={14} aria-hidden className={active ? "text-accent" : undefined} />
              <span className="hidden md:inline">{label}</span>
              <span className="sr-only md:hidden">{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="hidden items-center gap-1.5 text-[11px] text-faint lg:flex">
        <Activity size={12} aria-hidden />
        <span>Research &amp; education use only — not for emergency response</span>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="#38bdf8" strokeWidth="1.4" opacity="0.9" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.6" fill="none" stroke="#38bdf8" strokeWidth="1" opacity="0.45" />
      <path d="M12 2.5v19" stroke="#38bdf8" strokeWidth="1" opacity="0.35" />
      <circle cx="16.6" cy="8.2" r="2.1" fill="#f97316" />
      <circle cx="16.6" cy="8.2" r="3.6" fill="none" stroke="#f97316" strokeWidth="0.8" opacity="0.5" />
    </svg>
  );
}
