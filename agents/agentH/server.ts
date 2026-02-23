/**
 * Agent H — Summarization Service Provider #2 (Analytical)
 *
 * Competes with Agent E by offering:
 * - Lower pricing: 1 USDC (vs E's 1.5 USDC)
 * - TF-IDF sentence ranking (vs E's first-N-sentences approach)
 * - Returns topic_words and sentence importance scores
 *
 * TF-IDF ranks sentences by the importance of the terms they contain,
 * producing thematically richer summaries than positional selection.
 */

import express, { Request, Response } from "express";
import { ethers } from "ethers";
import { config } from "../shared/config";
import {
  IDENTITY_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
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
import { getEscrowData } from "../shared/escrow";

// ── Setup ──────────────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const wallet = new ethers.Wallet(config.agentHKey, provider);

const identity   = new ethers.Contract(config.contracts.identity, IDENTITY_REGISTRY_ABI, wallet);
const validation  = new ethers.Contract(config.contracts.validation, VALIDATION_REGISTRY_ABI, wallet);
const reputation  = new ethers.Contract(config.contracts.reputation, REPUTATION_REGISTRY_ABI, wallet);

const AGENT_H_PRICE = 1_000_000n; // 1 USDC — cheaper than Agent E's 1.5 USDC

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "to", "of", "in", "on", "at", "by", "for", "with", "about", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "from", "up", "down", "out", "off", "over", "under", "again", "then",
  "once", "and", "but", "or", "nor", "so", "yet", "both", "either",
  "that", "this", "these", "those", "it", "its", "we", "i", "you", "he",
  "she", "they", "them", "their", "our", "your", "my", "his", "her",
  "not", "no", "nor", "only", "own", "same", "than", "too", "very",
]);

const app = express();
app.use(express.json());
app.use(requestLogger("Agent H"));
app.use(apiKeyAuth);
app.use(standardLimiter);

// ── TF-IDF Summarization ───────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/\b[a-z]{3,}\b/g)?.filter((w) => !STOP_WORDS.has(w)) || [];
}

function computeTfIdf(sentences: string[]): number[] {
  if (sentences.length === 0) return [];

  const docCount = sentences.length;
  const sentenceTokens = sentences.map((s) => tokenize(s));

  // Document frequency: how many sentences contain each term
  const docFreq: Record<string, number> = {};
  for (const tokens of sentenceTokens) {
    for (const term of new Set(tokens)) {
      docFreq[term] = (docFreq[term] || 0) + 1;
    }
  }

  return sentenceTokens.map((tokens) => {
    if (tokens.length === 0) return 0;

    // TF: frequency of term in this sentence / total terms in sentence
    const termFreq: Record<string, number> = {};
    for (const t of tokens) termFreq[t] = (termFreq[t] || 0) + 1;

    let score = 0;
    for (const [term, freq] of Object.entries(termFreq)) {
      const tf = freq / tokens.length;
      const idf = Math.log((docCount + 1) / (docFreq[term] + 1)) + 1;
      score += tf * idf;
    }

    return score / tokens.length; // normalize by sentence length
  });
}

function extractTopicWords(text: string, topN: number = 8): string[] {
  const tokens = tokenize(text);
  const freq: Record<string, number> = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;

  return Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN)
    .map(([word]) => word);
}

function summarizeText(
  text: string,
  maxLength?: number,
): {
  summary: string;
  keyPoints: string[];
  topicWords: string[];
  sentenceScores: Array<{ sentence: string; score: number }>;
  compressionRatio: number;
  originalLength: number;
  summaryLength: number;
  algorithm: string;
} {
  const originalLength = text.length;
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  if (sentences.length <= 2) {
    // Not enough sentences for meaningful ranking
    const summary = text.trim();
    return {
      summary,
      keyPoints: [summary],
      topicWords: extractTopicWords(text),
      sentenceScores: sentences.map((s) => ({ sentence: s.trim(), score: 1.0 })),
      compressionRatio: 0,
      originalLength,
      summaryLength: summary.length,
      algorithm: "tfidf-ranking",
    };
  }

  // Compute TF-IDF scores for each sentence
  const scores = computeTfIdf(sentences);
  const sentenceScores = sentences.map((s, i) => ({ sentence: s.trim(), score: scores[i] }));

  // Sort by score (descending) to find most important sentences
  const ranked = [...sentenceScores].sort((a, b) => b.score - a.score);

  // Determine target number of sentences
  const targetSentences = maxLength
    ? Math.max(1, Math.min(sentences.length, Math.ceil(maxLength / 80)))
    : Math.max(1, Math.ceil(sentences.length * 0.3));

  // Select top sentences but preserve document order
  const topIndices = new Set(
    ranked.slice(0, targetSentences).map((r) => sentenceScores.indexOf(r))
  );
  const selectedSentences = sentenceScores
    .filter((_, i) => topIndices.has(i))
    .map((s) => s.sentence);

  const summary = selectedSentences.join(" ").trim();
  const topicWords = extractTopicWords(text);

  // Key points: the top-3 highest-scoring sentences
  const keyPoints = ranked.slice(0, Math.min(3, ranked.length)).map((r) => r.sentence);

  const summaryLength = summary.length;
  const compressionRatio = originalLength > 0
    ? Math.round((1 - summaryLength / originalLength) * 100) / 100
    : 0;

  return {
    summary,
    keyPoints,
    topicWords,
    sentenceScores: sentenceScores.slice(0, 10), // limit output size
    compressionRatio,
    originalLength,
    summaryLength,
    algorithm: "tfidf-ranking",
  };
}

// ── Endpoints ──────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    agent: "SummarizationBot-H",
    status: "healthy",
    wallet: wallet.address,
    stats: getStats(),
  });
});

app.get("/capabilities", (_req: Request, res: Response) => {
  res.json({
    agent: "SummarizationBot-H",
    did: `did:erc8004:${wallet.address.toLowerCase()}`,
    capabilities: ["summarization", "nlp", "text-analysis"],
    paymentProtocol: "x402",
    pricing: {
      "service-request": AGENT_H_PRICE.toString(),
      currency: "USDC",
      decimals: 6,
    },
    differentiators: [
      "Budget pricing (1 USDC vs market average)",
      "TF-IDF sentence ranking algorithm",
      "Returns topic_words and per-sentence importance scores",
    ],
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
    console.log(`[Agent H] 402 -> summarization (task: ${taskId})`);

    const paymentRequest = buildPaymentRequest({
      taskId,
      payee: wallet.address,
      amount: AGENT_H_PRICE,
      escrowAddress: config.contracts.escrow,
      usdcAddress: config.contracts.usdc,
    });

    res.status(402).json({
      error: "Payment Required",
      message: "x402: Pay to access analytical summarization service",
      payment: paymentRequest,
    });
    return;
  }

  console.log(`[Agent H] Received paid summarization request (task: ${taskId})`);

  let proof: X402PaymentProof;
  try {
    proof = parsePaymentProof(proofHeader);
  } catch (err: any) {
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
  } catch (err: any) {
    res.status(401).json({ error: err?.message || "Invalid payment proof signature" });
    return;
  }

  try {
    const escrowData = await getEscrowData(taskId);
    const isFunded = escrowData.status === 1n;
    const correctPayee = escrowData.payee.toLowerCase() === wallet.address.toLowerCase();
    const correctAmount = escrowData.amount >= AGENT_H_PRICE;

    if (!isFunded || !correctPayee || !correctAmount) {
      res.status(402).json({ error: "Payment not verified on-chain" });
      return;
    }

    savePaymentProof(taskId, proof.txHash, proof.payer, escrowData.amount.toString());
    markPaymentVerified(taskId);
  } catch (err: any) {
    console.error(`[Agent H] Escrow verification failed:`, err.message);
    res.status(500).json({ error: "Failed to verify payment on-chain" });
    return;
  }

  const result = summarizeText(text, maxLength);
  const serviceResult = { ...result, timestamp: Date.now() };

  const resultJson = JSON.stringify(serviceResult);
  const resultHash = ethers.id(resultJson);

  try {
    const tx = await validation.submitResult(taskId, resultHash, `data:json,${resultJson}`);
    await tx.wait();
    console.log(`[Agent H] Proof submitted (hash: ${resultHash.slice(0, 18)}...)`);
    saveServiceResult(taskId, "summarization", `${text.slice(0, 50)}... (${text.length} chars)`, resultJson, resultHash);
    saveTaskRecord(taskId, proof.payer, "summarization");
    updateTaskStatus(taskId, "completed");
  } catch (err: any) {
    console.error(`[Agent H] Failed to submit proof:`, err.message);
    res.status(500).json({ error: "Failed to submit proof on-chain" });
    return;
  }

  res.json({
    status: "delivered",
    taskId,
    result: serviceResult,
    resultHash,
    proofSubmitted: true,
    provider: "SummarizationBot-H",
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
    const escrowData = await getEscrowData(taskId);
    if (escrowData.status === 2n) {
      score = 5; comment = "Payment released promptly after verification";
    } else if (escrowData.status === 1n) {
      score = 4; comment = "Payment still pending release";
    } else {
      score = 3; comment = "Payment status unclear";
    }
  } catch (err: any) {
    score = 4; comment = "Could not verify escrow status";
  }

  try {
    const tx = await reputation.submitFeedback(clientAddress, taskId, score, comment);
    await tx.wait();
    console.log(`[Agent H] Submitted feedback for client ${clientAddress.slice(0, 10)}...: ${score}/5`);
    res.json({ status: "feedback_submitted", score, comment });
  } catch (err: any) {
    console.error(`[Agent H] Feedback error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Startup ────────────────────────────────────────────────────────────────

export async function startAgentH(port?: number) {
  const p = port || config.agentHPort;

  try {
    const existing = await identity.getAgent(wallet.address);
    if (!existing.active) {
      console.log(`[Agent H] Registering in IdentityRegistry...`);
      const tx = await identity.registerAgent(
        "SummarizationBot-H",
        `http://localhost:${p}`,
        ["summarization", "nlp", "text-analysis"]
      );
      await tx.wait();
      console.log(`[Agent H] Registered as SummarizationBot-H`);
    } else {
      console.log(`[Agent H] Already registered as ${existing.name}`);
    }
  } catch (err: any) {
    console.error(`[Agent H] Registration error:`, err.message);
  }

  return new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const server = app.listen(p, () => {
      console.log(`[Agent H] Analytical Summarization Service listening on port ${p}`);
      console.log(`[Agent H] Wallet: ${wallet.address}`);
      console.log(`[Agent H] Pricing: ${ethers.formatUnits(AGENT_H_PRICE, 6)} USDC per request`);
      console.log(`[Agent H] Algorithm: TF-IDF sentence ranking`);
      resolve(server);
    });

    const shutdown = () => {
      console.log(`\n[Agent H] Shutting down gracefully...`);
      server.close(() => { closeDb(); process.exit(0); });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  });
}

if (require.main === module) {
  startAgentH();
}

export { app };
