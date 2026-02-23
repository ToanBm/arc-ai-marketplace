"use client";

import { Languages, FileText, Code, BarChart2, type LucideIcon } from "lucide-react";
import { useQuote } from "@/lib/hooks";

const iconMap: Record<string, LucideIcon> = {
  translation: Languages,
  summarization: FileText,
  "code-review": Code,
  oracle: BarChart2,
};

const colorMap: Record<string, string> = {
  translation: "text-blue-400",
  summarization: "text-green-400",
  "code-review": "text-purple-400",
  oracle: "text-yellow-400",
};

const descriptions: Record<string, string> = {
  translation: "Translate text between languages using AI agents on the Arc network. Powered by x402 payment protocol.",
  summarization: "Get concise summaries of long text, articles, or documents. AI agents compete to deliver the best result.",
  "code-review": "Submit code for automated review with suggestions for improvements, bugs, and best practices.",
  oracle: "Get live ETH/USD or BTC/USD price data from Agents B & C via Chainlink. Runs the full 10-step on-chain workflow — free for users, funded by the treasury.",
};

interface ServiceCardProps {
  type: string;
  active: boolean;
  onClick: () => void;
}

export default function ServiceCard({ type, active, onClick }: ServiceCardProps) {
  const Icon = iconMap[type] || FileText;
  const color = colorMap[type] || "text-gray-400";
  const isOracle = type === "oracle";
  const { data: quote } = useQuote(isOracle ? "" : type);

  return (
    <button
      onClick={onClick}
      className={`text-left bg-surface rounded-xl p-5 border transition-colors ${
        active
          ? "border-accent ring-1 ring-accent/50"
          : "border-surface-light hover:border-gray-600"
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        <Icon className={`w-6 h-6 ${color}`} />
        <h3 className="text-base font-semibold text-white capitalize">
          {type.replace("-", " ")}
        </h3>
        <span className="ml-auto text-xs font-medium text-accent-light bg-accent/10 px-2 py-0.5 rounded-full">
          {isOracle ? "Free" : quote ? `${quote.price} USDC` : "…"}
        </span>
      </div>
      <p className="text-sm text-gray-400">{descriptions[type] || type}</p>
      <p className="text-xs text-gray-600 mt-2">
        {isOracle ? "via Marketplace Client → B / C" : quote ? `via ${quote.provider}` : "Loading provider…"}
      </p>
      <p className="text-xs text-accent-light mt-1">
        {active ? "Form open below" : "Click to submit a request"}
      </p>
    </button>
  );
}
