/**
 * Agent B — Oracle Provider Service
 *
 * An autonomous AI agent that:
 * 1. Registers itself in the ERC-8004 Identity Registry
 * 2. Listens for oracle data requests via HTTP
 * 3. Implements x402: responds with 402 Payment Required
 * 4. After payment proof (with signature verification), fetches and delivers data
 * 5. Submits proof-of-work hash on-chain
 * 6. Computes its own reputation feedback for the client
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
  getOracleResult,
  saveTaskRecord,
  updateTaskStatus,
  savePaymentProof,
  markPaymentVerified,
  getStats,
  closeDb,
} from "../shared/storage";

// ── Setup ──────────────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const wallet = new ethers.Wallet(config.agentBKey, provider);

const identity   = new ethers.Contract(config.contracts.identity, IDENTITY_REGISTRY_ABI, wallet);
const validation  = new ethers.Contract(config.contracts.validation, VALIDATION_REGISTRY_ABI, wallet);
const reputation  = new ethers.Contract(config.contracts.reputation, REPUTATION_REGISTRY_ABI, wallet);
const escrow      = new ethers.Contract(config.contracts.escrow, PAYMENT_ESCROW_ABI, provider); // read-only

const app = express();
app.use(express.json());
app.use(requestLogger("Agent B"));
app.use(apiKeyAuth);
app.use(standardLimiter);

// ── Endpoints ──────────────────────────────────────────────────────────────

/**
 * GET /health — Basic health check
 */
app.get("/health", (_req: Request, res: Response) => {
  res.json({ agent: "OracleBot-B", status: "healthy", wallet: wallet.address, stats: getStats() });
});

/**
 * GET /capabilities — A2A protocol: advertise capabilities
 */
app.get("/capabilities", (_req: Request, res: Response) => {
  res.json({
    agent: "OracleBot-B",
    did: `did:erc8004:${wallet.address.toLowerCase()}`,
    capabilities: ["oracle", "analysis", "chainlink"],
    supportedPairs: ["ETH/USD", "BTC/USD"],
    paymentProtocol: "x402",
    pricing: {
      "oracle-query": "5000000", // 5 USDC per query
      currency: "USDC",
      decimals: 6,
    },
  });
});

/**
 * POST /oracle/request — Request oracle data (x402 flow)
 *
 * Phase 1: Client sends request without payment → 402 response (no pre-fetch)
 * Phase 2: Client sends request WITH signed X-402-Payment-Proof → verify, fetch, deliver
 */
app.post("/oracle/request", oracleLimiter, async (req: Request, res: Response) => {
  const { pair, taskId } = req.body;

  if (!pair || !taskId) {
    res.status(400).json({ error: "Missing 'pair' and/or 'taskId'" });
    return;
  }

  // Check for payment proof header
  const proofHeader = req.headers["x-402-payment-proof"] as string | undefined;

  if (!proofHeader) {
    // ── Phase 1: No payment yet → respond with 402 (no data pre-fetch) ──
    console.log(`[Agent B] Received unpaid request for ${pair} (task: ${taskId})`);

    const paymentRequest = buildPaymentRequest({
      taskId,
      payee: wallet.address,
      amount: config.defaultPaymentUsdc,
      escrowAddress: config.contracts.escrow,
      usdcAddress: config.contracts.usdc,
    });

    res.status(402).json({
      error: "Payment Required",
      message: "x402: Pay to access oracle data",
      payment: paymentRequest,
    });
    return;
  }

  // ── Phase 2: Payment proof provided → verify signature, verify on-chain, deliver ──
  console.log(`[Agent B] Received paid request for ${pair} (task: ${taskId})`);

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
      console.log(`[Agent B] Signature mismatch: recovered ${recoveredSigner}, declared ${proof.payer}`);
      res.status(401).json({ error: "Payment proof signature verification failed" });
      return;
    }
    console.log(`[Agent B] Signature verified for payer ${proof.payer.slice(0, 10)}...`);
  } catch (err) {
    res.status(401).json({ error: "Invalid payment proof signature" });
    return;
  }

  // Verify payment on-chain
  try {
    const escrowData = await escrow.getEscrow(taskId);
    const isFunded = escrowData.status === 1n; // EscrowStatus.Funded
    const correctPayee = escrowData.payee.toLowerCase() === wallet.address.toLowerCase();
    const correctAmount = escrowData.amount >= config.defaultPaymentUsdc;

    if (!isFunded || !correctPayee || !correctAmount) {
      console.log(`[Agent B] Payment verification failed:`, { isFunded, correctPayee, correctAmount, escrowPayee: escrowData.payee, agentWallet: wallet.address, amount: escrowData.amount.toString(), required: config.defaultPaymentUsdc.toString() });
      res.status(402).json({ error: "Payment not verified on-chain" });
      return;
    }

    console.log(`[Agent B] Payment verified on-chain: ${ethers.formatUnits(escrowData.amount, 6)} USDC`);
    try { savePaymentProof(taskId, proof.txHash, proof.payer, escrowData.amount.toString()); } catch {}
    try { markPaymentVerified(taskId); } catch {}
  } catch (err: any) {
    console.error(`[Agent B] On-chain verification error:`, err.message);
    res.status(500).json({ error: "Failed to verify payment on-chain", detail: err.message });
    return;
  }

  // Fetch oracle data (only after payment is verified)
  let result: AnalysisResult;
  try {
    result = await fetchOracleDataWithAnalysis(pair);
  } catch (err: any) {
    console.error(`[Agent B] Failed to fetch oracle data:`, err.message);
    res.status(500).json({ error: "Failed to fetch oracle data", detail: err.message });
    return;
  }

  // Submit proof-of-work to Validation Registry
  const resultJson = JSON.stringify(result);
  const resultHash = ethers.id(resultJson);

  try {
    const tx = await validation.submitResult(taskId, resultHash, `data:json,${resultJson}`);
    await tx.wait();
    console.log(`[Agent B] Proof-of-work submitted to ValidationRegistry (hash: ${resultHash.slice(0, 18)}...)`);
  } catch (err: any) {
    console.error(`[Agent B] Failed to submit proof:`, err.message);
    res.status(500).json({ error: "Failed to submit proof on-chain", detail: err.message });
    return;
  }

  // DB saves are best-effort — don't fail the request over a storage error
  try { saveOracleResult(taskId, pair, resultJson, resultHash); } catch (e: any) { console.warn(`[Agent B] saveOracleResult:`, e.message); }
  try { saveTaskRecord(taskId, proof.payer, pair); } catch (e: any) { console.warn(`[Agent B] saveTaskRecord:`, e.message); }
  try { updateTaskStatus(taskId, "completed"); } catch (e: any) { console.warn(`[Agent B] updateTaskStatus:`, e.message); }

  // Return the result to Agent A
  res.json({
    status: "delivered",
    taskId,
    result,
    resultHash,
    proofSubmitted: true,
  });
});

/**
 * POST /feedback — Provider computes its own feedback score for the client.
 *                  Score is based on payment verification, not client-supplied.
 */
app.post("/feedback", async (req: Request, res: Response) => {
  const { taskId, clientAddress } = req.body;

  if (!taskId || !clientAddress) {
    res.status(400).json({ error: "Missing taskId or clientAddress" });
    return;
  }

  // Provider autonomously computes score based on interaction quality
  // Score 5 = payment was verified and released on time
  // Score 4 = payment verified but slow
  // Score 3 = payment verified with issues
  let score = 5;
  let comment = "Prompt payment and verification";

  try {
    const escrowData = await escrow.getEscrow(taskId);
    // If escrow was released (status 2), that's a good interaction
    if (escrowData.status === 2n) {
      score = 5;
      comment = "Payment released promptly after verification";
    } else if (escrowData.status === 1n) {
      // Still funded — payment not yet released
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
    console.log(`[Agent B] Submitted feedback for client ${clientAddress.slice(0, 10)}...: ${score}/5`);
    res.json({ status: "feedback_submitted", score, comment });
  } catch (err: any) {
    console.error(`[Agent B] Feedback error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Startup ────────────────────────────────────────────────────────────────

export async function startAgentB(port?: number) {
  const p = port || config.agentBPort;

  // Register in Identity Registry if not already registered
  try {
    const existing = await identity.getAgent(wallet.address);
    if (!existing.active) {
      console.log(`[Agent B] Registering in IdentityRegistry...`);
      const tx = await identity.registerAgent(
        "OracleBot-B",
        `http://localhost:${p}`,
        ["oracle", "analysis", "chainlink"]
      );
      await tx.wait();
      console.log(`[Agent B] Registered as OracleBot-B`);
    } else {
      console.log(`[Agent B] Already registered as ${existing.name}`);
    }
  } catch (err: any) {
    console.error(`[Agent B] Registration error:`, err.message);
  }

  return new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const server = app.listen(p, () => {
      console.log(`[Agent B] Oracle Provider listening on port ${p}`);
      console.log(`[Agent B] Wallet: ${wallet.address}`);
      resolve(server);
    });

    // Graceful shutdown
    const shutdown = () => {
      console.log(`\n[Agent B] Shutting down gracefully...`);
      server.close(() => {
        closeDb();
        console.log(`[Agent B] Server closed.`);
        process.exit(0);
      });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  });
}

// Run standalone
if (require.main === module) {
  startAgentB();
}

export { app };
