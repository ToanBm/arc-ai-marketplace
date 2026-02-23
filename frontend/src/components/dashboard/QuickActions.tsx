"use client";

import Link from "next/link";
import { Languages, FileText, Code, TrendingUp } from "lucide-react";

const actions = [
  {
    label: "Translation",
    description: "Translate text with AI agents",
    icon: Languages,
    href: "/services?type=translation",
    color: "text-blue-400",
  },
  {
    label: "Summarization",
    description: "Summarize documents and text",
    icon: FileText,
    href: "/services?type=summarization",
    color: "text-green-400",
  },
  {
    label: "Code Review",
    description: "Get AI-powered code reviews",
    icon: Code,
    href: "/services?type=code-review",
    color: "text-purple-400",
  },
  {
    label: "Price Oracle",
    description: "Real-time on-chain price data",
    icon: TrendingUp,
    href: "/services?type=oracle",
    color: "text-amber-400",
  },
];

export default function QuickActions() {
  return (
    <div className="bg-surface rounded-xl p-5 border border-surface-light">
      <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {actions.map((action) => (
          <Link
            key={action.label}
            href={action.href}
            className="flex items-center gap-3 bg-surface-dark hover:bg-surface-light rounded-lg p-4 transition-colors group"
          >
            <action.icon
              className={`w-8 h-8 ${action.color} group-hover:scale-110 transition-transform`}
            />
            <div>
              <p className="text-sm font-medium text-white">{action.label}</p>
              <p className="text-xs text-gray-500">{action.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
