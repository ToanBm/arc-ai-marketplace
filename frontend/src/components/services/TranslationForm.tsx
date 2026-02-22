"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAccount, useWriteContract } from "wagmi";
import { submitTranslation } from "@/lib/api";
import { useConfig, useQuote } from "@/lib/hooks";
import { erc20Abi, TREASURY_ADDRESS } from "@/lib/contracts";
import ServiceResult from "./ServiceResult";
import { Loader2 } from "lucide-react";

const schema = z.object({
  text: z.string().min(1, "Text is required").max(5000),
  targetLanguage: z.string().min(1, "Select a language"),
});

type FormData = z.infer<typeof schema>;

const LANGUAGES = [
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "ja", name: "Japanese" },
  { code: "pt", name: "Portuguese" },
  { code: "it", name: "Italian" },
  { code: "zh", name: "Chinese" },
];

export default function TranslationForm() {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { address, isConnected } = useAccount();
  const { data: configData, error: configError } = useConfig();
  const { data: quote, error: quoteError } = useQuote("translation");
  const { writeContractAsync } = useWriteContract();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const usdcAddress = configData?.contracts?.usdc as `0x${string}` | undefined;
  const dataReady = !!usdcAddress && !!quote;

  const onSubmit = async (data: FormData) => {
    setError(null);
    setResult(null);
    setSubmitting(true);

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

      // Step 1: Send USDC payment (exact provider price)
      setStatus("Sending payment...");
      const txHash = await writeContractAsync({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "transfer",
        args: [TREASURY_ADDRESS as `0x${string}`, BigInt(quote.amount)],
      });

      // Step 2: Wait for tx to be mined
      setStatus("Confirming payment...");
      await new Promise((r) => setTimeout(r, 1000));

      // Step 3: Submit service request with payment proof
      setStatus("Processing service...");
      const res = await submitTranslation({
        ...data,
        paymentTxHash: txHash,
      });
      setResult(res);
    } catch (err: any) {
      if (err?.message?.includes("User rejected")) {
        setError("Transaction rejected by user");
      } else {
        setError(err.response?.data?.error || err.message || "Request failed");
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
          <label className="block text-sm text-gray-400 mb-1">Text to translate</label>
          <textarea
            {...register("text")}
            rows={4}
            className="w-full bg-surface-dark border border-surface-light rounded-lg px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent resize-none"
            placeholder="Enter text to translate..."
          />
          {errors.text && <p className="text-xs text-red-400 mt-1">{errors.text.message}</p>}
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Target Language</label>
          <select
            {...register("targetLanguage")}
            className="w-full bg-surface-dark border border-surface-light rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-accent"
          >
            <option value="">Select language...</option>
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>{lang.name}</option>
            ))}
          </select>
          {errors.targetLanguage && <p className="text-xs text-red-400 mt-1">{errors.targetLanguage.message}</p>}
        </div>
        {(configError || quoteError) && (
          <p className="text-xs text-yellow-400">Failed to load config from gateway. Check that the gateway is running.</p>
        )}
        {quote && (
          <p className="text-xs text-gray-500">Provider: {quote.provider}</p>
        )}
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
      {result && <ServiceResult result={result} />}
    </div>
  );
}
