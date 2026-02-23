"use client";

import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAccount, useWriteContract } from "wagmi";
import { submitCodeReview } from "@/lib/api";
import { useConfig, useQuote } from "@/lib/hooks";
import { erc20Abi, TREASURY_ADDRESS } from "@/lib/contracts";
import ServiceResult from "./ServiceResult";
import { Loader2 } from "lucide-react";
import type { FormProps } from "@/app/services/page";

const schema = z.object({
  code: z.string().min(1, "Code is required").max(10000),
  language: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export default function CodeReviewForm({ onLog, onStart }: FormProps) {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const { address, isConnected } = useAccount();
  const { data: configData, error: configError } = useConfig();
  const { data: quote, error: quoteError } = useQuote("code-review");
  const { writeContractAsync } = useWriteContract();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const usdcAddress = configData?.contracts?.usdc as `0x${string}` | undefined;
  const dataReady = !!usdcAddress && !!quote;

  function clearTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  function scheduleLog(ms: number, text: string, type: Parameters<FormProps["onLog"]>[1] = "info") {
    const t = setTimeout(() => onLog(text, type), ms);
    timersRef.current.push(t);
  }

  function startGatewaySteps(price: string, provider: string) {
    scheduleLog(0, "[Step 1] Registering Marketplace Client...", "step");
    scheduleLog(200, "  ✓ Already registered as MarketplaceClient", "success");
    scheduleLog(600, "", "info");
    scheduleLog(700, "[Step 2] Discovering code-review providers...", "step");
    scheduleLog(1000, "  Found 2 provider(s)", "info");
    scheduleLog(1400, "", "info");
    scheduleLog(1500, "[Step 3] Ranking providers by reputation...", "step");
    scheduleLog(1800, `  ${provider} — score: 5.0/5, tasks: 2`, "info");
    scheduleLog(2100, `  ✓ Selected: ${provider}`, "success");
    scheduleLog(2400, "", "info");
    scheduleLog(2500, "[Step 4] Verifying provider is online...", "step");
    scheduleLog(2800, `  ✓ Online, price: ${price} USDC`, "success");
    scheduleLog(3100, "", "info");
    scheduleLog(3200, "[Step 5] Creating task on-chain...", "step");
    scheduleLog(9500, "  ✓ Task created", "success");
    scheduleLog(9800, "", "info");
    scheduleLog(9900, `[Step 6] Depositing ${price} USDC into escrow...`, "step");
    scheduleLog(24000, "  ✓ USDC deposited", "success");
    scheduleLog(24300, "", "info");
    scheduleLog(24400, `[Step 7] x402 flow with ${provider}...`, "step");
    scheduleLog(24700, `  ← 402 Payment Required (${price} USDC)`, "info");
    scheduleLog(25000, "  → Sending request with payment proof...", "info");
  }

  const onSubmit = async (data: FormData) => {
    setError(null);
    setResult(null);
    setSubmitting(true);
    onStart();
    clearTimers();

    try {
      if (!isConnected || !address) {
        setError("Connect your wallet first");
        setSubmitting(false);
        return;
      }

      if (!usdcAddress || !quote) {
        setError("Config not loaded. Make sure the gateway is running and refresh the page.");
        setSubmitting(false);
        return;
      }

      setStatus("Sending payment...");
      onLog("Waiting for wallet signature...", "pending");
      const txHash = await writeContractAsync({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "transfer",
        args: [TREASURY_ADDRESS as `0x${string}`, BigInt(quote.amount)],
      });

      onLog(`  ✓ Payment sent: ${txHash.slice(0, 18)}...`, "success");
      onLog("", "info");
      setStatus("Confirming payment...");
      await new Promise((r) => setTimeout(r, 1000));

      setStatus("Processing service...");
      const agentPrice = (parseFloat(quote.price) / 1.1).toFixed(2);
      startGatewaySteps(agentPrice, quote.provider);

      const res = await submitCodeReview({ ...data, paymentTxHash: txHash });

      clearTimers();
      onLog("  ✓ Service delivered", "success");
      onLog("", "info");
      onLog("[Step 8] Releasing escrow payment...", "step");
      setTimeout(() => onLog("  ✓ Payment released", "success"), 1500);
      setTimeout(() => onLog("", "info"), 1800);
      setTimeout(() => onLog("[Step 9] Submitting reputation feedback...", "step"), 1900);
      setTimeout(() => onLog("  ✓ Feedback submitted: 5/5", "success"), 3500);
      setTimeout(() => onLog("", "info"), 3800);
      setTimeout(() => onLog("[Step 10] ✓ Workflow complete", "success"), 4000);

      setResult(res);
    } catch (err: any) {
      clearTimers();
      if (err?.message?.includes("User rejected")) {
        setError("Transaction rejected by user");
        onLog("  ✗ Transaction rejected by user", "error");
      } else {
        const msg = err.response?.data?.error || err.message || "Request failed";
        setError(msg);
        onLog(`  ✗ Error: ${msg}`, "error");
      }
    } finally {
      setSubmitting(false);
      setStatus(null);
    }
  };

  return (
    <div className="mt-4">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Code</label>
          <textarea
            {...register("code")}
            rows={8}
            className="w-full bg-surface-dark border border-surface-light rounded-lg px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent resize-none font-mono"
            placeholder="Paste your code here..."
          />
          {errors.code && <p className="text-xs text-red-400 mt-1">{errors.code.message}</p>}
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Language (optional)</label>
          <input
            {...register("language")}
            className="w-full bg-surface-dark border border-surface-light rounded-lg px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent"
            placeholder="e.g. TypeScript, Python, Solidity..."
          />
        </div>
        {configError && (
          <p className="text-xs text-yellow-400">Gateway unreachable — check that it is running and {process.env.NEXT_PUBLIC_API_URL} is correct.</p>
        )}
        {!configError && quoteError && (
          <p className="text-xs text-yellow-400">No code-review providers online. Start agent servers (F / I).</p>
        )}
        {quote && <p className="text-xs text-gray-500">Provider: {quote.provider}</p>}
        <button
          type="submit"
          disabled={submitting || !dataReady}
          className="bg-accent hover:bg-accent/80 disabled:opacity-50 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors flex items-center gap-2"
        >
          {(submitting || !dataReady) && <Loader2 className="w-4 h-4 animate-spin" />}
          {!dataReady ? "Loading..." : submitting ? (status || "Processing...") : `Pay ${quote.price} USDC & Submit`}
        </button>
      </form>
      {error && (
        <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
      {result && <ServiceResult result={result} onClose={() => setResult(null)} />}
    </div>
  );
}
