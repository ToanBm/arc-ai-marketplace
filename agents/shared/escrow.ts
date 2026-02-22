import { ethers } from "ethers";
import { config } from "./config";
import { PAYMENT_ESCROW_ABI } from "./abis";

export interface EscrowData {
  taskId: string;
  payer: string;
  payee: string;
  amount: bigint;
  status: bigint;
  createdAt: bigint;
  deadline: bigint;
}

/**
 * Fetch escrow data using a fresh RPC provider with retry logic.
 * Avoids stale provider issues that cause silent 500 errors in agents.
 */
export async function getEscrowData(taskId: string, retries = 3): Promise<EscrowData> {
  let lastError: any;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const freshProvider = new ethers.JsonRpcProvider(config.rpcUrl);
      const escrow = new ethers.Contract(config.contracts.escrow, PAYMENT_ESCROW_ABI, freshProvider);
      return await escrow.getEscrow(taskId);
    } catch (err: any) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  throw lastError;
}
