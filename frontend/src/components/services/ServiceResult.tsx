"use client";

import { CheckCircle, User, CreditCard, Star } from "lucide-react";
import { formatAddress, truncateId } from "@/lib/utils";

interface ServiceResultProps {
  result: {
    taskId: string;
    serviceType: string;
    provider: { name: string; address: string };
    result: unknown;
    payment: string;
    reputationScore: number;
  };
}

export default function ServiceResult({ result }: ServiceResultProps) {
  return (
    <div className="bg-surface rounded-xl p-5 border border-green-500/30 mt-4">
      <div className="flex items-center gap-2 mb-4">
        <CheckCircle className="w-5 h-5 text-green-400" />
        <h3 className="text-base font-semibold text-white">Result</h3>
        <span className="ml-auto text-xs text-gray-500">
          Task: {truncateId(result.taskId)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="flex items-center gap-2 bg-surface-dark rounded-lg px-3 py-2">
          <User className="w-4 h-4 text-accent-light" />
          <div>
            <p className="text-xs text-gray-500">Provider</p>
            <p className="text-sm text-white">{result.provider.name}</p>
            <p className="text-xs text-gray-500">
              {formatAddress(result.provider.address)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-surface-dark rounded-lg px-3 py-2">
          <CreditCard className="w-4 h-4 text-yellow-400" />
          <div>
            <p className="text-xs text-gray-500">Payment</p>
            <p className="text-sm text-white">{result.payment}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-surface-dark rounded-lg px-3 py-2">
          <Star className="w-4 h-4 text-yellow-400" />
          <div>
            <p className="text-xs text-gray-500">Reputation</p>
            <p className="text-sm text-white">
              {result.reputationScore?.toFixed(1) ?? "N/A"} / 5
            </p>
          </div>
        </div>
      </div>

      <div className="bg-surface-dark rounded-lg p-4">
        <p className="text-xs text-gray-500 mb-2">Output</p>
        <pre className="text-sm text-gray-200 whitespace-pre-wrap break-words font-mono">
          {typeof result.result === "string"
            ? result.result
            : JSON.stringify(result.result, null, 2)}
        </pre>
      </div>
    </div>
  );
}
