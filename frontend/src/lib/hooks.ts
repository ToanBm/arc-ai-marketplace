import useSWR from "swr";
import { useReadContract } from "wagmi";
import {
  fetchStats,
  fetchHealth,
  fetchProviders,
  fetchProvidersByCapability,
  fetchHistory,
  fetchTaskDetail,
  fetchPricing,
  fetchConfig,
  fetchQuote,
} from "./api";
import { erc20Abi } from "./contracts";

export function useStats() {
  return useSWR("stats", fetchStats, { refreshInterval: 5000 });
}

export function useHealth() {
  return useSWR("health", fetchHealth, { refreshInterval: 15000 });
}

export function useProviders(capability?: string) {
  const key = capability ? `providers-${capability}` : "providers";
  const fetcher = capability
    ? () => fetchProvidersByCapability(capability)
    : fetchProviders;
  return useSWR(key, fetcher, { refreshInterval: 10000 });
}

export function useHistory() {
  return useSWR("history", fetchHistory, { refreshInterval: 3000 });
}

export function useTaskDetail(taskId: string | null) {
  return useSWR(taskId ? `task-${taskId}` : null, () =>
    fetchTaskDetail(taskId!)
  );
}

export function usePricing() {
  return useSWR("pricing", fetchPricing, {
    revalidateOnFocus: true,
    revalidateOnMount: true,
    errorRetryCount: 5,
    errorRetryInterval: 2000,
  });
}

export function useQuote(service: string) {
  return useSWR(service ? `quote-${service}` : null, () => fetchQuote(service), {
    refreshInterval: 30_000,
    revalidateOnMount: true,
    errorRetryCount: 5,
    errorRetryInterval: 2000,
  });
}

export function useConfig() {
  return useSWR("config", fetchConfig, {
    revalidateOnFocus: true,
    revalidateOnMount: true,
    errorRetryCount: 5,
    errorRetryInterval: 2000,
  });
}

export function useTokenBalance(
  tokenAddress: `0x${string}` | undefined,
  userAddress: `0x${string}` | undefined,
) {
  return useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!tokenAddress && !!userAddress,
      refetchInterval: 10_000,
    },
  });
}
