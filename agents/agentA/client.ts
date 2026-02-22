/**
 * Agent A — Client Trading Bot
 *
 * An autonomous AI agent that:
 * 1. Discovers oracle providers via ERC-8004 Identity Registry
 * 2. Checks provider reputation before hiring
 * 3. Verifies provider is online before committing funds
 * 4. Creates a task and deposits USDC escrow (x402 pre-payment)
 * 5. Requests oracle data from Agent B (handles 402 → pay → retry)
 * 6. Verifies the result on-chain via Validation Registry
 * 7. Releases payment from escrow
 * 8. Submits dynamic reputation feedback based on measurable quality
 */

import axios from "axios";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { config } from "../shared/config";
import {
  IDENTITY_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  PAYMENT_ESCROW_ABI,
  USDC_ABI,
} from "../shared/abis";
import { parsePaymentRequest, buildPaymentProof, X402PaymentRequest } from "../shared/x402";
import { SUPPORTED_PAIRS, normalizePair } from "../shared/chainlink";

// ── Workflow Event Logger ──────────────────────────────────────────────────

const LOG_FILE = path.join(__dirname, "..", "data", "workflow-log.json");

interface WorkflowEvent {
  runId: string;
  timestamp: string;
  attempt: number;
  strategy: string;
  pair: string;
  step: number;
  status: "running" | "done" | "error";
  label: string;
  detail?: string;
  providerName?: string;
  providerAddr?: string;
}

function writeEvent(event: WorkflowEvent): void {
  let log: WorkflowEvent[] = [];
  try {
    log = JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
  } catch {
    // File doesn't exist yet
  }
  log.push(event);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// ── Selection Strategy ────────────────────────────────────────────────────

const COUNTER_FILE = path.join(__dirname, "..", "data", "selection-counter.json");

function getAndIncrementAttempt(): number {
  let attempt = 1;
  try {
    const data = JSON.parse(fs.readFileSync(COUNTER_FILE, "utf-8"));
    attempt = data.attempt ?? 1;
  } catch {
    // File doesn't exist yet — start at 1
  }
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ attempt: attempt + 1 }, null, 2));
  return attempt;
}

async function fetchCheapestProvider(providers: RankedProvider[]): Promise<RankedProvider | null> {
  let cheapest: RankedProvider | null = null;
  let lowestPrice = BigInt("999999999999999999");

  for (const p of providers) {
    try {
      const res = await axios.get(`${p.endpoint}/capabilities`, { timeout: 3000 });
      const price = BigInt(res.data.pricing["oracle-query"]);
      if (price < lowestPrice) {
        lowestPrice = price;
        cheapest = p;
      }
    } catch {
      // Skip providers whose pricing we can't fetch
    }
  }
  return cheapest;
}

interface RankedProvider {
  wallet: string;
  name: string;
  endpoint: string;
  did: string;
  avgScore: number;
  taskCount: bigint;
  successRate: number;
}

// ── Retry Helper ──────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = 3,
  delayMs: number = 2000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (i === maxRetries - 1) throw err;
      console.log(`  ⚠ ${label} failed (attempt ${i + 1}/${maxRetries}): ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

// ── Dynamic Scoring ───────────────────────────────────────────────────────

function computeProviderScore(params: {
  hashMatches: boolean;
  responseTimeMs: number;
  dataTimestamp: number;
}): { score: number; comment: string } {
  if (!params.hashMatches) {
    return { score: 1, comment: "Result hash mismatch — data integrity failure" };
  }

  let score = 5;
  const reasons: string[] = [];

  // Penalize slow responses (> 10s)
  if (params.responseTimeMs > 15000) {
    score -= 2;
    reasons.push("very slow response");
  } else if (params.responseTimeMs > 10000) {
    score -= 1;
    reasons.push("slow response");
  }

  // Penalize stale data (> 5 minutes old)
  const staleness = Date.now() - params.dataTimestamp;
  if (staleness > 600_000) {
    score -= 2;
    reasons.push("very stale data");
  } else if (staleness > 300_000) {
    score -= 1;
    reasons.push("slightly stale data");
  }

  score = Math.max(score, 1);

  const comment = reasons.length > 0
    ? `Deducted for: ${reasons.join(", ")}`
    : "Accurate data, fast delivery, verified on-chain";

  return { score, comment };
}

// ── Setup ──────────────────────────────────────────────────────────────────

const rpcProvider = new ethers.JsonRpcProvider(config.rpcUrl);
const wallet = new ethers.Wallet(config.agentAKey, rpcProvider);

const identity   = new ethers.Contract(config.contracts.identity, IDENTITY_REGISTRY_ABI, wallet);
const validation  = new ethers.Contract(config.contracts.validation, VALIDATION_REGISTRY_ABI, wallet);
const reputation  = new ethers.Contract(config.contracts.reputation, REPUTATION_REGISTRY_ABI, wallet);
const escrowContract = new ethers.Contract(config.contracts.escrow, PAYMENT_ESCROW_ABI, wallet);
const usdc       = new ethers.Contract(config.contracts.usdc, USDC_ABI, wallet);

// ── Registration Cache ────────────────────────────────────────────────────
let agentARegistered = false;

// ── Core Workflow ──────────────────────────────────────────────────────────

export interface WorkflowResult {
  taskId: string;
  provider: { address: string; name: string; endpoint: string };
  oracleResult: any;
  paymentTxHash: string;
  verificationTxHash: string;
  reputationScore: number;
}

/**
 * Run the full agent economy workflow:
 * Discovery → Negotiation → Escrow → Request → Verify → Pay → Reputation
 */
export async function runWorkflow(pair: string = "ETH/USD"): Promise<WorkflowResult> {
  // ── Input Validation ──
  const normalizedPair = normalizePair(pair);
  if (!normalizedPair) {
    throw new Error(`Invalid pair format: "${pair}". Expected format: ETH/USD`);
  }
  if (!SUPPORTED_PAIRS.includes(normalizedPair)) {
    throw new Error(`Unsupported pair: "${normalizedPair}". Supported: ${SUPPORTED_PAIRS.join(", ")}`);
  }
  pair = normalizedPair;

  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const attempt = getAndIncrementAttempt();
  let strategyUsed = "";
  const ev = (step: number, status: WorkflowEvent["status"], label: string, detail?: string, providerName?: string, providerAddr?: string) =>
    writeEvent({ runId, timestamp: new Date().toISOString(), attempt, strategy: strategyUsed, pair, step, status, label, detail, providerName, providerAddr });

  console.log("\n" + "=".repeat(60));
  console.log("  AGENT A — Client Trading Bot Workflow");
  console.log("=".repeat(60));

  ev(0, "running", "Workflow Started", `Pair: ${pair}, Attempt #${attempt}`);

  // ── Step 1: Register self in Identity Registry ───────────────────────
  console.log("\n[Step 1] Registering Agent A in Identity Registry...");
  ev(1, "running", "Register Agent");
  if (agentARegistered) {
    console.log("  ✓ Already registered (cached — skipping on-chain check)");
  } else {
    try {
      const existing = await identity.getAgent(wallet.address);
      if (!existing.active) {
        const tx = await identity.registerAgent(
          "TradingBot-A",
          "http://localhost:3401",
          ["trading", "client"]
        );
        await tx.wait();
        console.log("  ✓ Registered as TradingBot-A");
      } else {
        console.log(`  ✓ Already registered as ${existing.name}`);
      }
      agentARegistered = true;
    } catch (err: any) {
      console.error("  ✗ Registration failed:", err.message);
    }
  }
  ev(1, "done", "Register Agent", "Agent registered in Identity Registry");

  // ── Step 2: Discover and rank oracle providers ──────────────────────
  console.log("\n[Step 2] Discovering oracle providers...");
  ev(2, "running", "Discover Providers");
  const oracles = await identity.findByCapability("oracle");
  if (oracles.length === 0) {
    throw new Error("No oracle providers found in registry");
  }

  console.log(`  Found ${oracles.length} oracle provider(s)`);

  // Rank providers by reputation score (highest first)
  const ranked: RankedProvider[] = [];
  for (const oracle of oracles) {
    const rep = await reputation.getReputation(oracle.wallet);
    const avg = await reputation.getAverageScore(oracle.wallet);
    const successRate = rep.taskCount > 0n
      ? Number(rep.successCount) * 100 / Number(rep.taskCount)
      : 0;

    ranked.push({
      wallet: oracle.wallet,
      name: oracle.name,
      endpoint: oracle.endpoint,
      did: oracle.did,
      avgScore: Number(avg) / 100,
      taskCount: rep.taskCount,
      successRate,
    });
  }

  // Sort by: reputation score (desc), then by task count (desc, experience matters)
  ranked.sort((a, b) => {
    if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
    return Number(b.taskCount - a.taskCount);
  });

  // Display ranking table
  console.log("  ┌────────────────────────┬───────┬───────┬──────────┐");
  console.log("  │ Provider               │ Score │ Tasks │ Success  │");
  console.log("  ├────────────────────────┼───────┼───────┼──────────┤");
  for (const r of ranked) {
    const score = r.taskCount > 0n ? `${r.avgScore.toFixed(1)}/5` : "N/A  ";
    const tasks = String(r.taskCount).padStart(5);
    const success = r.taskCount > 0n ? `${r.successRate.toFixed(0)}%`.padStart(6) : "  N/A ";
    console.log(`  │ ${r.name.padEnd(22)} │ ${score} │${tasks} │${success}  │`);
  }
  console.log("  └────────────────────────┴───────┴───────┴──────────┘");

  // ── Multi-strategy provider selection ──────────────────────────────
  let chosenProvider: RankedProvider;

  if (attempt % 5 === 0) {
    const cheapest = await fetchCheapestProvider(ranked);
    if (cheapest) {
      chosenProvider = cheapest;
      strategyUsed = `cheapest (attempt #${attempt})`;
    } else {
      chosenProvider = ranked[0];
      strategyUsed = `reputation (attempt #${attempt}, cheapest fallback — pricing unavailable)`;
    }
  } else if (attempt % 3 === 0) {
    const newProviders = ranked.filter((p) => p.taskCount === 0n);
    if (newProviders.length > 0) {
      chosenProvider = newProviders[Math.floor(Math.random() * newProviders.length)];
      strategyUsed = `exploration (attempt #${attempt}) — trying new provider`;
    } else {
      chosenProvider = ranked[0];
      strategyUsed = `reputation (attempt #${attempt}, exploration fallback — no new providers)`;
    }
  } else {
    chosenProvider = ranked[0];
    strategyUsed = `reputation (attempt #${attempt})`;
  }

  console.log(`  Strategy: ${strategyUsed}`);
  console.log(`  ✓ Selected provider: ${chosenProvider.name} (${chosenProvider.wallet})`);
  console.log(`    Endpoint: ${chosenProvider.endpoint}`);
  console.log(`    DID: ${chosenProvider.did}`);
  ev(2, "done", "Discover Providers", `Found ${oracles.length} provider(s), strategy: ${strategyUsed}`, chosenProvider.name, chosenProvider.wallet);

  // ── Step 3: Verify provider is online + get pricing ─────────────────
  console.log("\n[Step 3] Verifying provider is online...");
  ev(3, "running", "Verify Provider", `Checking ${chosenProvider.name}`, chosenProvider.name, chosenProvider.wallet);

  let paymentAmount = config.defaultPaymentUsdc;
  try {
    const capRes = await withRetry(
      () => axios.get(`${chosenProvider.endpoint}/health`, { timeout: 5000 }),
      "Provider health check"
    );
    console.log(`  ✓ Provider is online (status: ${capRes.data.status})`);

    // Fetch pricing
    const pricingRes = await axios.get(`${chosenProvider.endpoint}/capabilities`, { timeout: 3000 });
    const providerPrice = BigInt(pricingRes.data.pricing["oracle-query"]);
    console.log(`  Provider charges ${ethers.formatUnits(providerPrice, 6)} USDC per query`);
    paymentAmount = providerPrice;
  } catch (err: any) {
    throw new Error(`Provider ${chosenProvider.name} is not reachable: ${err.message}`);
  }
  ev(3, "done", "Verify Provider", `Online, ${ethers.formatUnits(paymentAmount, 6)} USDC/query`, chosenProvider.name, chosenProvider.wallet);

  // ── Step 4: Create task on-chain ─────────────────────────────────────
  const taskIdRaw = `oracle-${pair}-${Date.now()}`;
  const taskId = ethers.id(taskIdRaw);
  console.log(`\n[Step 4] Creating task on-chain...`);
  ev(4, "running", "Create Task", `Task: ${taskIdRaw}`, chosenProvider.name, chosenProvider.wallet);
  console.log(`  Task: "${taskIdRaw}"`);
  console.log(`  TaskId: ${taskId.slice(0, 18)}...`);

  const createTx = await withRetry(
    async () => {
      const tx = await validation.createTask(
        taskId,
        chosenProvider.wallet,
        `Fetch ${pair} price from Chainlink + trend analysis`
      );
      await tx.wait();
      return tx;
    },
    "Create task"
  );
  console.log("  ✓ Task created in ValidationRegistry");
  ev(4, "done", "Create Task", `TaskId: ${taskId.slice(0, 18)}...`, chosenProvider.name, chosenProvider.wallet);

  // ── Step 5: Deposit USDC into escrow ─────────────────────────────────
  console.log(`\n[Step 5] Depositing ${ethers.formatUnits(paymentAmount, 6)} USDC into escrow...`);
  ev(5, "running", "Escrow Deposit", "Depositing USDC", chosenProvider.name, chosenProvider.wallet);

  const approveTx = await usdc.approve(config.contracts.escrow, paymentAmount);
  await approveTx.wait();
  console.log("  ✓ USDC approved for escrow");

  const depositTx = await escrowContract.deposit(taskId, chosenProvider.wallet, paymentAmount);
  await depositTx.wait();
  console.log("  ✓ USDC deposited into PaymentEscrow");
  ev(5, "done", "Escrow Deposit", `${ethers.formatUnits(paymentAmount, 6)} USDC deposited`, chosenProvider.name, chosenProvider.wallet);

  // ── Step 6: Request oracle data (x402 flow) ─────────────────────────
  console.log(`\n[Step 6] Requesting oracle data from ${chosenProvider.name}...`);
  ev(6, "running", "Request Data", "Phase 1: Sending initial request", chosenProvider.name, chosenProvider.wallet);
  const endpoint = chosenProvider.endpoint;

  // Phase 1: Initial request → expect 402
  console.log("  Phase 1: Sending initial request...");
  let paymentInfo: X402PaymentRequest;
  try {
    await axios.post(`${endpoint}/oracle/request`, { pair, taskId });
    throw new Error("Expected 402 but got 200");
  } catch (err: any) {
    if (err.response?.status === 402) {
      paymentInfo = err.response.data.payment;
      console.log("  ✓ Received 402 Payment Required");
      console.log(`    Amount: ${ethers.formatUnits(paymentInfo!.amount, 6)} USDC`);
      console.log(`    Payee: ${paymentInfo!.payee}`);
      ev(6, "done", "Request Data", `402 received — ${ethers.formatUnits(paymentInfo!.amount, 6)} USDC`, chosenProvider.name, chosenProvider.wallet);
    } else {
      throw new Error(`Unexpected response: ${err.message}`);
    }
  }

  // Phase 2: Re-request with signed payment proof
  console.log("  Phase 2: Sending request with signed payment proof...");
  ev(7, "running", "402 + Proof", "Sending signed payment proof", chosenProvider.name, chosenProvider.wallet);

  const proof = await buildPaymentProof({
    taskId,
    txHash: depositTx.hash,
    payer: wallet.address,
    wallet: wallet,
  });

  const requestStartTime = Date.now();
  const response = await withRetry(
    () => axios.post(
      `${endpoint}/oracle/request`,
      { pair, taskId },
      { headers: { "X-402-Payment-Proof": JSON.stringify(proof) } }
    ),
    "Oracle data request"
  );
  const responseTimeMs = Date.now() - requestStartTime;

  const { result: oracleResult, resultHash } = response.data;
  console.log("  ✓ Oracle data received!");
  console.log(`    Pair: ${oracleResult.oracleData.pair}`);
  console.log(`    Price: $${oracleResult.oracleData.price}`);
  console.log(`    Trend: ${oracleResult.trend} (confidence: ${(oracleResult.confidence * 100).toFixed(0)}%)`);
  console.log(`    Source: ${oracleResult.oracleData.source}`);
  console.log(`    Response time: ${responseTimeMs}ms`);
  ev(7, "done", "402 + Proof", `$${oracleResult.oracleData.price} (${oracleResult.trend})`, chosenProvider.name, chosenProvider.wallet);

  // ── Step 7: Verify result on-chain ───────────────────────────────────
  console.log(`\n[Step 7] Verifying result on-chain...`);
  ev(8, "running", "Verify Result", "Verifying result hash on-chain", chosenProvider.name, chosenProvider.wallet);

  // Verify the hash matches
  const hashMatches = await validation.verifyHash(taskId, resultHash);
  console.log(`  Hash verification: ${hashMatches ? "✓ MATCH" : "✗ MISMATCH"}`);

  if (!hashMatches) {
    // Dispute and refund
    console.log("  ✗ Disputing result and requesting refund...");
    await (await validation.disputeResult(taskId)).wait();
    await (await escrowContract.refund(taskId)).wait();
    ev(8, "error", "Verify Result", "Hash mismatch — disputed & refunded", chosenProvider.name, chosenProvider.wallet);
    ev(10, "error", "Workflow Failed", "Result verification failed", chosenProvider.name, chosenProvider.wallet);
    throw new Error("Result verification failed — payment refunded");
  }

  // Mark as verified
  const verifyTx = await validation.verifyResult(taskId);
  await verifyTx.wait();
  console.log("  ✓ Result verified in ValidationRegistry");
  ev(8, "done", "Verify Result", "Hash verified on-chain", chosenProvider.name, chosenProvider.wallet);

  // ── Step 8: Release payment (x402 settlement) ───────────────────────
  console.log(`\n[Step 8] Releasing payment from escrow...`);
  ev(9, "running", "Release Payment", "Releasing USDC from escrow", chosenProvider.name, chosenProvider.wallet);
  const releaseTx = await escrowContract.release(taskId);
  await releaseTx.wait();
  console.log(`  ✓ ${ethers.formatUnits(paymentAmount, 6)} USDC released to ${chosenProvider.name}`);
  ev(9, "done", "Release Payment", `${ethers.formatUnits(paymentAmount, 6)} USDC released`, chosenProvider.name, chosenProvider.wallet);

  // ── Step 9: Submit dynamic reputation feedback ─────────────────────
  console.log(`\n[Step 9] Submitting reputation feedback...`);
  ev(10, "running", "Feedback", "Submitting reputation", chosenProvider.name, chosenProvider.wallet);

  // Compute a dynamic score based on measurable quality
  const { score: dynamicScore, comment: feedbackComment } = computeProviderScore({
    hashMatches: true,
    responseTimeMs,
    dataTimestamp: oracleResult.oracleData.timestamp,
  });

  // Agent A rates Agent B with the computed score
  const feedbackTx = await reputation.submitFeedback(
    chosenProvider.wallet,
    taskId,
    dynamicScore,
    feedbackComment
  );
  await feedbackTx.wait();
  console.log(`  ✓ Agent A rated ${chosenProvider.name}: ${dynamicScore}/5 — "${feedbackComment}"`);

  // Tell Agent B to rate us back (provider decides its own score)
  try {
    await axios.post(`${endpoint}/feedback`, {
      taskId,
      clientAddress: wallet.address,
    });
    console.log(`  ✓ ${chosenProvider.name} submitted reciprocal feedback`);
  } catch (err: any) {
    console.log(`  ⚠ ${chosenProvider.name} feedback request failed: ${err.message}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────
  const finalScore = await reputation.getAverageScore(chosenProvider.wallet);

  console.log("\n" + "=".repeat(60));
  console.log("  WORKFLOW COMPLETE");
  console.log("=".repeat(60));
  console.log(`  Task ID:     ${taskId.slice(0, 18)}...`);
  console.log(`  Provider:    ${chosenProvider.name}`);
  console.log(`  Price:       $${oracleResult.oracleData.price} (${oracleResult.trend})`);
  console.log(`  Payment:     ${ethers.formatUnits(paymentAmount, 6)} USDC`);
  console.log(`  Our Rating:  ${dynamicScore}/5`);
  console.log(`  Provider Rep: ${Number(finalScore) / 100}/5.00`);
  console.log("=".repeat(60) + "\n");

  ev(10, "done", "Workflow Complete", `$${oracleResult.oracleData.price} | ${ethers.formatUnits(paymentAmount, 6)} USDC | rep ${(Number(finalScore) / 100).toFixed(1)}/5`, chosenProvider.name, chosenProvider.wallet);

  return {
    taskId,
    provider: {
      address: chosenProvider.wallet,
      name: chosenProvider.name,
      endpoint: chosenProvider.endpoint,
    },
    oracleResult,
    paymentTxHash: releaseTx.hash,
    verificationTxHash: verifyTx.hash,
    reputationScore: Number(finalScore) / 100,
  };
}

// Run standalone
if (require.main === module) {
  runWorkflow("ETH/USD").catch(console.error);
}
