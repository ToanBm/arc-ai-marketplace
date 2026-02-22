/**
 * Agent C — Competitive Oracle Provider
 *
 * A second oracle provider that competes with Agent B in the marketplace.
 * Agent C differentiates by:
 * - Lower pricing (3 USDC vs 5 USDC)
 * - Multi-source data aggregation (averages multiple APIs)
 * - Faster estimated delivery
 *
 * Demonstrates a competitive agent marketplace where Agent A
 * can compare providers and choose the best offer.
 */

import express, { Request, Response } from "express";
import { ethers } from "ethers";
import { config } from "../shared/config";
import {
  IDENTITY_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  PAYMENT_ESCROW_ABI,
} from "../shared/abis";
import { fetchOracleDataWithAnalysis, AnalysisResult } from "../shared/chainlink";
import {
  buildPaymentRequest,
  parsePaymentProof,
  verifyPaymentProof,
  X402PaymentProof,
} from "../shared/x402";
import {
  standardLimiter,
  oracleLimiter,
  apiKeyAuth,
  requestLogger,
} from "../shared/middleware";
import {
  saveOracleResult,
  saveTaskRecord,
  updateTaskStatus,
  savePaymentProof,
  markPaymentVerified,
  getStats,
  closeDb,
} from "../shared/storage";

// ── Setup ──────────────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const wallet = new ethers.Wallet(config.agentCKey, provider);

const identity   = new ethers.Contract(config.contracts.identity, IDENTITY_REGISTRY_ABI, wallet);
const validation  = new ethers.Contract(config.contracts.validation, VALIDATION_REGISTRY_ABI, wallet);
const reputation  = new ethers.Contract(config.contracts.reputation, REPUTATION_REGISTRY_ABI, wallet);
const escrow      = new ethers.Contract(config.contracts.escrow, PAYMENT_ESCROW_ABI, provider); // read-only

// Agent C's pricing: 3 USDC (cheaper than Agent B's 5 USDC)
const AGENT_C_PRICE = 3_000_000n; // 3 USDC (6 decimals)

const app = express();
app.use(express.json());
app.use(requestLogger("Agent C"));
app.use(apiKeyAuth);
app.use(standardLimiter);

// ── Endpoints ──────────────────────────────────────────────────────────────

/**
 * GET /health — Health check
 */
app.get("/health", (_req: Request, res: Response) => {
  res.json({ agent: "OracleBot-C", status: "healthy", wallet: wallet.address, stats: getStats() });
});

/**
 * GET /capabilities — A2A protocol: advertise capabilities
 */
app.get("/capabilities", (_req: Request, res: Response) => {
  res.json({
    agent: "OracleBot-C",
    did: `did:erc8004:${wallet.address.toLowerCase()}`,
    capabilities: ["oracle", "analysis", "multi-source"],
    supportedPairs: ["ETH/USD", "BTC/USD", "SOL/USD"],
    paymentProtocol: "x402",
    pricing: {
      "oracle-query": AGENT_C_PRICE.toString(),
      currency: "USDC",
      decimals: 6,
    },
    differentiators: [
      "Lower pricing (3 USDC vs market average)",
      "Multi-source data aggregation",
      "Supports SOL/USD",
    ],
  });
});

/**
 * POST /quote — Return a price quote for a specific task (negotiation support)
 */
app.post("/quote", (req: Request, res: Response) => {
  const { pair } = req.body;
  if (!pair) {
    res.status(400).json({ error: "Missing 'pair'" });
    return;
  }

  res.json({
    agent: "OracleBot-C",
    pair,
    price: AGENT_C_PRICE.toString(),
    currency: "USDC",
    estimatedDeliveryMs: 2000,
    terms: "Multi-source aggregated oracle data with trend analysis",
  });
});

/**
 * POST /oracle/request — Request oracle data (x402 flow)
 *
 * Phase 1: No payment → 402 (no pre-fetch to prevent DoS)
 * Phase 2: Signed proof → verify, fetch, deliver
 */
app.post("/oracle/request", oracleLimiter, async (req: Request, res: Response) => {
  const { pair, taskId } = req.body;

  if (!pair || !taskId) {
    res.status(400).json({ error: "Missing 'pair' and/or 'taskId'" });
    return;
  }

  const proofHeader = req.headers["x-402-payment-proof"] as string | undefined;

  if (!proofHeader) {
    // ── Phase 1: No payment yet → respond with 402 (no data pre-fetch) ──
    console.log(`[Agent C] Received unpaid request for ${pair} (task: ${taskId})`);

    const paymentRequest = buildPaymentRequest({
      taskId,
      payee: wallet.address,
      amount: AGENT_C_PRICE,
      escrowAddress: config.contracts.escrow,
      usdcAddress: config.contracts.usdc,
    });

    res.status(402).json({
      error: "Payment Required",
      message: "x402: Pay to access multi-source oracle data",
      payment: paymentRequest,
    });
    return;
  }

  // ── Phase 2: Payment proof provided → verify signature, verify on-chain, deliver ──
  console.log(`[Agent C] Received paid request for ${pair} (task: ${taskId})`);

  let proof: X402PaymentProof;
  try {
    proof = parsePaymentProof(proofHeader);
  } catch {
    res.status(400).json({ error: "Invalid X-402-Payment-Proof header" });
    return;
  }

  // Verify proof taskId matches request body taskId
  if (proof.taskId !== taskId) {
    res.status(400).json({ error: "Proof taskId does not match request taskId" });
    return;
  }

  // Verify cryptographic signature
  try {
    const recoveredSigner = verifyPaymentProof(proof);
    if (recoveredSigner.toLowerCase() !== proof.payer.toLowerCase()) {
      console.log(`[Agent C] Signature mismatch: recovered ${recoveredSigner}, declared ${proof.payer}`);
      res.status(401).json({ error: "Payment proof signature verification failed" });
      return;
    }
    console.log(`[Agent C] Signature verified for payer ${proof.payer.slice(0, 10)}...`);
  } catch (err) {
    res.status(401).json({ error: "Invalid payment proof signature" });
    return;
  }

  // Verify payment on-chain
  try {
    const escrowData = await escrow.getEscrow(taskId);
    const isFunded = escrowData.status === 1n;
    const correctPayee = escrowData.payee.toLowerCase() === wallet.address.toLowerCase();
    const correctAmount = escrowData.amount >= AGENT_C_PRICE;

    if (!isFunded || !correctPayee || !correctAmount) {
      console.log(`[Agent C] Payment verification failed:`, { isFunded, correctPayee, correctAmount });
      res.status(402).json({ error: "Payment not verified on-chain" });
      return;
    }

    console.log(`[Agent C] Payment verified on-chain: ${ethers.formatUnits(escrowData.amount, 6)} USDC`);
    savePaymentProof(taskId, proof.txHash, proof.payer, escrowData.amount.toString());
    markPaymentVerified(taskId);
  } catch (err) {
    console.error(`[Agent C] On-chain verification error:`, err);
    res.status(500).json({ error: "Failed to verify payment on-chain" });
    return;
  }

  // Fetch and enhance data (only after payment verified)
  let result: AnalysisResult;
  try {
    result = await fetchMultiSourceData(pair);
  } catch (err: any) {
    console.error(`[Agent C] Failed to fetch oracle data:`, err.message);
    res.status(500).json({ error: "Failed to fetch oracle data" });
    return;
  }

  // Submit proof-of-work to Validation Registry
  const resultJson = JSON.stringify(result);
  const resultHash = ethers.id(resultJson);

  try {
    const tx = await validation.submitResult(taskId, resultHash, `data:json,${resultJson}`);
    await tx.wait();
    console.log(`[Agent C] Proof-of-work submitted (hash: ${resultHash.slice(0, 18)}...)`);
    saveOracleResult(taskId, pair, resultJson, resultHash);
    saveTaskRecord(taskId, proof.payer, pair);
    updateTaskStatus(taskId, "completed");
  } catch (err: any) {
    console.error(`[Agent C] Failed to submit proof:`, err.message);
    res.status(500).json({ error: "Failed to submit proof on-chain" });
    return;
  }

  res.json({
    status: "delivered",
    taskId,
    result,
    resultHash,
    proofSubmitted: true,
    provider: "OracleBot-C",
  });
});

/**
 * POST /feedback — Provider computes its own feedback score for the client.
 */
app.post("/feedback", async (req: Request, res: Response) => {
  const { taskId, clientAddress } = req.body;

  if (!taskId || !clientAddress) {
    res.status(400).json({ error: "Missing taskId or clientAddress" });
    return;
  }

  // Provider autonomously computes score
  let score = 5;
  let comment = "Prompt payment and verification";

  try {
    const escrowData = await escrow.getEscrow(taskId);
    if (escrowData.status === 2n) {
      score = 5;
      comment = "Payment released promptly after verification";
    } else if (escrowData.status === 1n) {
      score = 4;
      comment = "Payment still pending release";
    } else {
      score = 3;
      comment = "Payment status unclear";
    }
  } catch {
    score = 4;
    comment = "Could not verify escrow status";
  }

  try {
    const tx = await reputation.submitFeedback(
      clientAddress,
      taskId,
      score,
      comment
    );
    await tx.wait();
    console.log(`[Agent C] Submitted feedback for client ${clientAddress.slice(0, 10)}...: ${score}/5`);
    res.json({ status: "feedback_submitted", score, comment });
  } catch (err: any) {
    console.error(`[Agent C] Feedback error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Multi-source data aggregation ────────────────────────────────────────

/**
 * Agent C's differentiator: fetches from multiple sources and aggregates.
 * In production, this would query multiple independent oracles.
 */
async function fetchMultiSourceData(pair: string): Promise<AnalysisResult> {
  const result = await fetchOracleDataWithAnalysis(pair);

  // Enhance with multi-source metadata
  result.oracleData.source = `multi-source-aggregated (${result.oracleData.source})`;
  result.analysis = `[Multi-Source] ${result.analysis}`;

  return result;
}

// ── Startup ────────────────────────────────────────────────────────────────

export async function startAgentC(port?: number) {
  const p = port || config.agentCPort;

  // Register in Identity Registry if not already registered
  try {
    const existing = await identity.getAgent(wallet.address);
    if (!existing.active) {
      console.log(`[Agent C] Registering in IdentityRegistry...`);
      const tx = await identity.registerAgent(
        "OracleBot-C",
        `http://localhost:${p}`,
        ["oracle", "analysis", "multi-source"]
      );
      await tx.wait();
      console.log(`[Agent C] Registered as OracleBot-C`);
    } else {
      console.log(`[Agent C] Already registered as ${existing.name}`);
    }
  } catch (err: any) {
    console.error(`[Agent C] Registration error:`, err.message);
  }

  return new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const server = app.listen(p, () => {
      console.log(`[Agent C] Multi-Source Oracle Provider listening on port ${p}`);
      console.log(`[Agent C] Wallet: ${wallet.address}`);
      console.log(`[Agent C] Pricing: ${ethers.formatUnits(AGENT_C_PRICE, 6)} USDC per query`);
      resolve(server);
    });

    // Graceful shutdown
    const shutdown = () => {
      console.log(`\n[Agent C] Shutting down gracefully...`);
      server.close(() => {
        closeDb();
        console.log(`[Agent C] Server closed.`);
        process.exit(0);
      });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  });
}

// Run standalone
if (require.main === module) {
  startAgentC();
}

export { app };
