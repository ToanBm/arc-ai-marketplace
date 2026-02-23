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
  onClose: () => void;
}

export default function ServiceResult({ result, onClose }: ServiceResultProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-surface rounded-2xl border border-white/10 shadow-2xl max-w-2xl w-full animate-in zoom-in-95 duration-200 overflow-hidden">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-6">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <h3 className="text-xl font-bold text-white">Service Delivered</h3>
            <span className="ml-auto text-xs text-gray-500 font-mono">
              Task: {truncateId(result.taskId)}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 border border-white/5">
              <User className="w-5 h-5 text-accent-light" />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold text-white/40">Provider</p>
                <p className="text-sm font-medium text-white">{result.provider.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 border border-white/5">
              <CreditCard className="w-5 h-5 text-yellow-500" />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold text-white/40">Payment</p>
                <p className="text-sm font-medium text-white">{result.payment}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 border border-white/5">
              <Star className="w-5 h-5 text-yellow-500" />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold text-white/40">Reputation</p>
                <p className="text-sm font-medium text-white">
                  {result.reputationScore?.toFixed(1) ?? "5.0"} / 5
                </p>
              </div>
            </div>
          </div>

          <div className="bg-surface-dark rounded-xl p-5 border border-white/5">
            <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Output Result</p>
            <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
              <pre className="text-sm text-gray-200 whitespace-pre-wrap break-words font-mono leading-relaxed">
                {typeof result.result === "string"
                  ? result.result
                  : JSON.stringify(result.result, null, 2)}
              </pre>
            </div>
          </div>

          <div className="mt-8 flex justify-end">
            <button
              onClick={onClose}
              className="bg-accent hover:bg-accent/80 text-white px-8 py-3 rounded-xl font-bold transition-all transform hover:scale-[1.02] active:scale-95 shadow-lg shadow-accent/20"
            >
              Use More
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
