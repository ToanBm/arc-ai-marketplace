/**
 * Agent E — Summarization Service Provider
 *
 * An autonomous AI agent that provides text summarization services:
 * 1. Registers itself in the ERC-8004 Identity Registry
 * 2. Listens for summarization requests via HTTP
 * 3. Implements x402: responds with 402 Payment Required
 * 4. After payment proof, performs summarization and delivers result
 * 5. Submits proof-of-work hash on-chain
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
import {
  buildPaymentRequest,
  parsePaymentProof,
  verifyPaymentProof,
  X402PaymentProof,
} from "../shared/x402";
import {
  standardLimiter,
  serviceLimiter,
  apiKeyAuth,
  requestLogger,
} from "../shared/middleware";
import {
  saveServiceResult,
  saveTaskRecord,
  updateTaskStatus,
  savePaymentProof,
  markPaymentVerified,
  getStats,
  closeDb,
} from "../shared/storage";

// ── Setup ──────────────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const wallet = new ethers.Wallet(config.agentEKey, provider);

const identity   = new ethers.Contract(config.contracts.identity, IDENTITY_REGISTRY_ABI, wallet);
const validation  = new ethers.Contract(config.contracts.validation, VALIDATION_REGISTRY_ABI, wallet);
const reputation  = new ethers.Contract(config.contracts.reputation, REPUTATION_REGISTRY_ABI, wallet);
const escrow      = new ethers.Contract(config.contracts.escrow, PAYMENT_ESCROW_ABI, provider);

const AGENT_E_PRICE = 1_500_000n; // 1.5 USDC

const app = express();
app.use(express.json());
app.use(requestLogger("Agent E"));
app.use(apiKeyAuth);
app.use(standardLimiter);

// ── Summarization Logic ────────────────────────────────────────────────────

function summarizeText(text: string, maxLength?: number): {
  summary: string;
  keyPoints: string[];
  compressionRatio: number;
  originalLength: number;
  summaryLength: number;
} {
  // Split into sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const originalLength = text.length;

  // Determine how many sentences to keep
  const targetSentences = maxLength
    ? Math.max(1, Math.min(sentences.length, Math.ceil(maxLength / 80)))
    : Math.max(1, Math.ceil(sentences.length * 0.3));

  // Take first N sentences as summary
  const summarySentences = sentences.slice(0, targetSentences);
  const summary = summarySentences.join(" ").trim();

  // Extract key points: find sentences with important keywords
  const importantWords = ["important", "key", "significant", "critical", "main", "primary",
    "result", "conclusion", "therefore", "however", "notably", "essential"];

  const keyPoints: string[] = [];
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (importantWords.some((w) => lower.includes(w))) {
      keyPoints.push(sentence.trim());
    }
  }

  // If no key points found via keywords, use first and last sentences
  if (keyPoints.length === 0) {
    keyPoints.push(sentences[0].trim());
    if (sentences.length > 1) {
      keyPoints.push(sentences[sentences.length - 1].trim());
    }
  }

  // Limit key points
  const limitedKeyPoints = keyPoints.slice(0, 5);

  const summaryLength = summary.length;
  const compressionRatio = originalLength > 0
    ? Math.round((1 - summaryLength / originalLength) * 100) / 100
    : 0;

  return {
    summary,
    keyPoints: limitedKeyPoints,
    compressionRatio,
    originalLength,
    summaryLength,
  };
}

// ── Endpoints ──────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ agent: "SummarizationBot-E", status: "healthy", wallet: wallet.address, stats: getStats() });
});

app.get("/capabilities", (_req: Request, res: Response) => {
  res.json({
    agent: "SummarizationBot-E",
    did: `did:erc8004:${wallet.address.toLowerCase()}`,
    capabilities: ["summarization", "nlp", "text-analysis"],
    paymentProtocol: "x402",
    pricing: {
      "service-request": AGENT_E_PRICE.toString(),
      currency: "USDC",
      decimals: 6,
    },
  });
});

app.post("/service/request", serviceLimiter, async (req: Request, res: Response) => {
  const { text, maxLength, taskId } = req.body;

  if (!text || !taskId) {
    res.status(400).json({ error: "Missing 'text' and/or 'taskId'" });
    return;
  }

  const proofHeader = req.headers["x-402-payment-proof"] as string | undefined;

  if (!proofHeader) {
    console.log(`[Agent E] 402 -> summarization (task: ${taskId})`);

    const paymentRequest = buildPaymentRequest({
      taskId,
      payee: wallet.address,
      amount: AGENT_E_PRICE,
      escrowAddress: config.contracts.escrow,
      usdcAddress: config.contracts.usdc,
    });

    res.status(402).json({
      error: "Payment Required",
      message: "x402: Pay to access summarization service",
      payment: paymentRequest,
    });
    return;
  }

  console.log(`[Agent E] Received paid summarization request (task: ${taskId})`);

  let proof: X402PaymentProof;
  try {
    proof = parsePaymentProof(proofHeader);
  } catch {
    res.status(400).json({ error: "Invalid X-402-Payment-Proof header" });
    return;
  }

  if (proof.taskId !== taskId) {
    res.status(400).json({ error: "Proof taskId does not match request taskId" });
    return;
  }

  try {
    const recoveredSigner = verifyPaymentProof(proof);
    if (recoveredSigner.toLowerCase() !== proof.payer.toLowerCase()) {
      res.status(401).json({ error: "Payment proof signature verification failed" });
      return;
    }
  } catch {
    res.status(401).json({ error: "Invalid payment proof signature" });
    return;
  }

  try {
    const escrowData = await escrow.getEscrow(taskId);
    const isFunded = escrowData.status === 1n;
    const correctPayee = escrowData.payee.toLowerCase() === wallet.address.toLowerCase();
    const correctAmount = escrowData.amount >= AGENT_E_PRICE;

    if (!isFunded || !correctPayee || !correctAmount) {
      res.status(402).json({ error: "Payment not verified on-chain" });
      return;
    }

    savePaymentProof(taskId, proof.txHash, proof.payer, escrowData.amount.toString());
    markPaymentVerified(taskId);
  } catch {
    res.status(500).json({ error: "Failed to verify payment on-chain" });
    return;
  }

  // Perform summarization
  const result = summarizeText(text, maxLength);
  const serviceResult = {
    ...result,
    timestamp: Date.now(),
  };

  const resultJson = JSON.stringify(serviceResult);
  const resultHash = ethers.id(resultJson);

  try {
    const tx = await validation.submitResult(taskId, resultHash, `data:json,${resultJson}`);
    await tx.wait();
    console.log(`[Agent E] Proof submitted (hash: ${resultHash.slice(0, 18)}...)`);
    saveServiceResult(taskId, "summarization", `${text.slice(0, 50)}... (${text.length} chars)`, resultJson, resultHash);
    saveTaskRecord(taskId, proof.payer, "summarization");
    updateTaskStatus(taskId, "completed");
  } catch (err: any) {
    console.error(`[Agent E] Failed to submit proof:`, err.message);
    res.status(500).json({ error: "Failed to submit proof on-chain" });
    return;
  }

  res.json({
    status: "delivered",
    taskId,
    result: serviceResult,
    resultHash,
    proofSubmitted: true,
    provider: "SummarizationBot-E",
  });
});

app.post("/feedback", async (req: Request, res: Response) => {
  const { taskId, clientAddress } = req.body;

  if (!taskId || !clientAddress) {
    res.status(400).json({ error: "Missing taskId or clientAddress" });
    return;
  }

  let score = 5;
  let comment = "Prompt payment and verification";

  try {
    const escrowData = await escrow.getEscrow(taskId);
    if (escrowData.status === 2n) {
      score = 5; comment = "Payment released promptly after verification";
    } else if (escrowData.status === 1n) {
      score = 4; comment = "Payment still pending release";
    } else {
      score = 3; comment = "Payment status unclear";
    }
  } catch {
    score = 4; comment = "Could not verify escrow status";
  }

  try {
    const tx = await reputation.submitFeedback(clientAddress, taskId, score, comment);
    await tx.wait();
    console.log(`[Agent E] Submitted feedback for client ${clientAddress.slice(0, 10)}...: ${score}/5`);
    res.json({ status: "feedback_submitted", score, comment });
  } catch (err: any) {
    console.error(`[Agent E] Feedback error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Startup ────────────────────────────────────────────────────────────────

export async function startAgentE(port?: number) {
  const p = port || config.agentEPort;

  try {
    const existing = await identity.getAgent(wallet.address);
    if (!existing.active) {
      console.log(`[Agent E] Registering in IdentityRegistry...`);
      const tx = await identity.registerAgent(
        "SummarizationBot-E",
        `http://localhost:${p}`,
        ["summarization", "nlp", "text-analysis"]
      );
      await tx.wait();
      console.log(`[Agent E] Registered as SummarizationBot-E`);
    } else {
      console.log(`[Agent E] Already registered as ${existing.name}`);
    }
  } catch (err: any) {
    console.error(`[Agent E] Registration error:`, err.message);
  }

  return new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const server = app.listen(p, () => {
      console.log(`[Agent E] Summarization Service listening on port ${p}`);
      console.log(`[Agent E] Wallet: ${wallet.address}`);
      console.log(`[Agent E] Pricing: ${ethers.formatUnits(AGENT_E_PRICE, 6)} USDC per request`);
      resolve(server);
    });

    const shutdown = () => {
      console.log(`\n[Agent E] Shutting down gracefully...`);
      server.close(() => { closeDb(); process.exit(0); });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  });
}

if (require.main === module) {
  startAgentE();
}

export { app };
