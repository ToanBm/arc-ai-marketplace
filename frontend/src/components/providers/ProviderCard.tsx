"use client";

import { Star, Hash } from "lucide-react";
import { formatAddress } from "@/lib/utils";

interface ProviderCardProps {
  provider: {
    address: string;
    name: string;
    capabilities: string[];
    reputation: {
      averageScore: number;
      taskCount: number;
    };
  };
}

export default function ProviderCard({ provider }: ProviderCardProps) {
  const score = provider.reputation?.averageScore ?? 0;

  return (
    <div className="bg-surface rounded-xl p-5 border border-surface-light">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-base font-semibold text-white">
            {provider.name}
          </h3>
          <p className="text-xs text-gray-500 font-mono mt-0.5">
            {formatAddress(provider.address)}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-yellow-500/10 px-2 py-1 rounded-lg">
          <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
          <span className="text-sm font-medium text-yellow-400">
            {score.toFixed(1)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {provider.capabilities?.map((cap) => (
          <span
            key={cap}
            className="text-xs bg-accent/15 text-accent-light px-2 py-0.5 rounded-full"
          >
            {cap}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Hash className="w-3 h-3" />
        <span>{provider.reputation?.taskCount ?? 0} tasks completed</span>
      </div>
    </div>
  );
}
