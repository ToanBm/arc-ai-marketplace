import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";

const hardhat = defineChain({
  id: 31337,
  name: "Hardhat",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
  testnet: true,
});

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc-testnet.arc.io"] },
  },
  testnet: true,
});

export const wagmiConfig = getDefaultConfig({
  appName: "Arc AI Marketplace",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "demo",
  chains: [hardhat, arcTestnet],
  ssr: true,
});
