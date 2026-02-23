"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { Cpu } from "lucide-react";
import { useTokenBalance, useConfig } from "@/lib/hooks";

export default function Header() {
  const { address, isConnected } = useAccount();
  const { data: configData } = useConfig();
  const usdcAddress = configData?.contracts?.usdc as `0x${string}` | undefined;

  const { data: balance } = useTokenBalance(usdcAddress, address);
  const formattedBalance =
    balance !== undefined ? (Number(balance) / 1e6).toFixed(2) : null;

  return (
    <header className="h-16 bg-surface border-b border-surface-light flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <Cpu className="w-6 h-6 text-accent-light" />
        <h1 className="text-lg font-bold text-white tracking-tight">AgentNexus</h1>
      </div>
      <div className="flex items-center gap-4">
        {isConnected && formattedBalance !== null && (
          <span className="text-sm text-gray-300 bg-surface-dark px-3 py-1.5 rounded-lg border border-surface-light">
            {formattedBalance} <span className="text-accent-light">USDC</span>
          </span>
        )}
        <ConnectButton
          showBalance={false}
          chainStatus="icon"
          accountStatus="address"
        />
      </div>
    </header>
  );
}
