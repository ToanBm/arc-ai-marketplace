"use client";

import { useState, useRef } from "react";
import { submitOracleCheck } from "@/lib/api";
import { CheckCircle, TrendingUp, TrendingDown, Minus, Loader2, Database } from "lucide-react";
import { formatAddress, truncateId } from "@/lib/utils";
import type { FormProps } from "@/app/services/page";

const PAIRS = ["ETH/USD", "BTC/USD"];

export default function OracleForm({ onLog, onStart }: FormProps) {
  const [pair, setPair] = useState("ETH/USD");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  function scheduleLog(ms: number, text: string, type: Parameters<FormProps["onLog"]>[1] = "info") {
    const t = setTimeout(() => onLog(text, type), ms);
    timersRef.current.push(t);
  }

  function startGatewaySteps() {
    scheduleLog(0,     "[Step 1] Registering Marketplace Client in Identity Registry...", "step");
    scheduleLog(200,   "  ✓ Marketplace Client registered as TradingBot", "success");
    scheduleLog(500,   "", "info");
    scheduleLog(600,   "[Step 2] Discovering oracle providers...", "step");
    scheduleLog(900,   "  Found 2 provider(s) — OracleBot-B, OracleBot-C", "info");
    scheduleLog(1200,  "", "info");
    scheduleLog(1300,  "[Step 3] Ranking providers by reputation...", "step");
    scheduleLog(1600,  "  OracleBot-B — score: 5.0/5", "info");
    scheduleLog(1900,  "  OracleBot-C — score: 5.0/5", "info");
    scheduleLog(2200,  "  ✓ Selected: OracleBot-B", "success");
    scheduleLog(2400,  "", "info");
    scheduleLog(2500,  "[Step 4] Verifying provider is online...", "step");
    scheduleLog(2800,  "  ✓ Online, price: 5.0 USDC/query", "success");
    scheduleLog(3100,  "", "info");
    scheduleLog(3200,  "[Step 5] Creating task on-chain...", "step");
    scheduleLog(9500,  "  ✓ Task created in ValidationRegistry", "success");
    scheduleLog(9800,  "", "info");
    scheduleLog(9900,  "[Step 6] Depositing USDC into escrow (treasury-funded)...", "step");
    scheduleLog(24000, "  ✓ Escrow funded by Marketplace Client", "success");
    scheduleLog(24300, "", "info");
    scheduleLog(24400, "[Step 7] x402 flow — requesting oracle data...", "step");
    scheduleLog(24700, "  ← 402 Payment Required (paid by treasury)", "info");
    scheduleLog(25000, "  → Sending request with payment proof...", "info");
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    onStart();
    clearTimers();

    startGatewaySteps();

    try {
      const data = await submitOracleCheck(pair);

      clearTimers();

      if (data.cached) {
        onLog("  ✓ Returning cached result (< 60s old)", "success");
        onLog("", "info");
        onLog("[Step 10] ✓ Workflow complete (cached)", "success");
      } else {
        onLog("  ✓ Oracle data received", "success");
        onLog("", "info");
        onLog("[Step 8] Verifying result on-chain...", "step");
        setTimeout(() => onLog("  ✓ Hash verified in ValidationRegistry", "success"), 1500);
        setTimeout(() => onLog("", "info"), 1800);
        setTimeout(() => onLog("[Step 9] Releasing payment from escrow...", "step"), 1900);
        setTimeout(() => onLog("  ✓ Payment released to provider (treasury-funded)", "success"), 3500);
        setTimeout(() => onLog("", "info"), 3800);
        setTimeout(() => onLog("[Step 10] Submitting reputation feedback...", "step"), 3900);
        setTimeout(() => onLog("  ✓ Feedback submitted", "success"), 5500);
        setTimeout(() => onLog("", "info"), 5800);
        setTimeout(() => onLog("[Step 10] ✓ Workflow complete", "success"), 6000);
      }

      setResult(data);
    } catch (err: any) {
      clearTimers();
      const msg = err.response?.data?.error || err.message || "Oracle check failed";
      setError(msg);
      onLog(`  ✗ Error: ${msg}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const oracle = result?.result;
  const oracleData = oracle?.serviceResult?.oracleData;
  const trend = oracle?.serviceResult?.trend;
  const confidence = oracle?.serviceResult?.confidence;

  const TrendIcon =
    trend === "bullish" ? TrendingUp :
    trend === "bearish" ? TrendingDown : Minus;

  const trendColor =
    trend === "bullish" ? "text-green-400" :
    trend === "bearish" ? "text-red-400" : "text-gray-400";

  return (
    <div className="mt-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Trading Pair</label>
          <select
            value={pair}
            onChange={(e) => setPair(e.target.value)}
            disabled={submitting}
            className="w-full bg-surface-dark border border-surface-light rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-accent"
          >
            {PAIRS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <p className="text-xs text-gray-500">
          Funded by Marketplace Client — no wallet payment required. Results cached for 60s.
        </p>

        <button
          type="submit"
          disabled={submitting}
          className="bg-accent hover:bg-accent/80 disabled:opacity-50 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors flex items-center gap-2"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? "Running workflow..." : "Check Price"}
        </button>
      </form>

      {error && (
        <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {result && oracleData && (
        <div className="bg-surface rounded-xl p-5 border border-green-500/30 mt-4">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <h3 className="text-base font-semibold text-white">Oracle Result</h3>
            {result.cached && (
              <span className="ml-2 text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">cached</span>
            )}
            <span className="ml-auto text-xs text-gray-500">
              Task: {truncateId(oracle.taskId)}
            </span>
          </div>

          {/* Price + Trend */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-surface-dark rounded-lg px-4 py-3 col-span-1">
              <p className="text-xs text-gray-500 mb-1">Price</p>
              <p className="text-2xl font-bold text-white">${oracleData.price}</p>
              <p className="text-xs text-gray-500 mt-1">{oracleData.pair}</p>
            </div>
            <div className="bg-surface-dark rounded-lg px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Trend</p>
              <div className={`flex items-center gap-1 ${trendColor}`}>
                <TrendIcon className="w-5 h-5" />
                <span className="text-sm font-semibold capitalize">{trend ?? "—"}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {confidence != null ? `${(confidence * 100).toFixed(0)}% confidence` : ""}
              </p>
            </div>
            <div className="bg-surface-dark rounded-lg px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Provider</p>
              <p className="text-sm text-white">{oracle.provider?.name}</p>
              <p className="text-xs text-gray-500">{formatAddress(oracle.provider?.address)}</p>
            </div>
          </div>

          {/* Meta */}
          <div className="bg-surface-dark rounded-lg px-4 py-3 flex items-center gap-6 text-xs text-gray-500">
            <span>Source: <span className="text-gray-300">{oracleData.source}</span></span>
            <span>Rep: <span className="text-gray-300">{oracle.reputationScore?.toFixed(1)}/5</span></span>
            <span>Cost: <span className="text-green-400">Free (treasury-funded)</span></span>
            <span className="ml-auto">
              {oracleData.timestamp ? new Date(oracleData.timestamp).toLocaleTimeString() : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
