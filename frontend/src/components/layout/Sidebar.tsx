"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Zap, Users, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/services", label: "Services", icon: Zap },
  { href: "/providers", label: "Providers", icon: Users },
  { href: "/history", label: "History", icon: Clock },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-surface border-r border-surface-light flex flex-col py-4">
      <nav className="flex flex-col gap-1 px-3">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-accent/20 text-accent-light"
                  : "text-gray-400 hover:text-white hover:bg-surface-light"
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
