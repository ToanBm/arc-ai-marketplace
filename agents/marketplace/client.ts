/**
 * Marketplace Client — Universal Service Consumer
 *
 * A generalized client that can consume any service type in the marketplace:
 * - Translation (Agent D)
 * - Summarization (Agent E)
 * - Code Review (Agent F)
 *
 * Runs the full 10-step x402 workflow:
 * Register → Discover → Rank → Verify → Task → Escrow → x402 → Verify Hash → Release → Feedback
 *
 * Usage:
 *   ts-node agents/marketplace/client.ts translation '{"text":"Hello world","targetLanguage":"es"}'
 *   ts-node agents/marketplace/client.ts summarization '{"text":"Long text here..."}'
 *   ts-node agents/marketplace/client.ts code-review '{"code":"console.log(x)","language":"javascript"}'
 */

import axios from "axios";
import { ethers } from "ethers";
import { config } from "../shared/config";
import {
  IDENTITY_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  PAYMENT_ESCROW_ABI,
  USDC_ABI,
} from "../shared/abis";
import { buildPaymentProof, X402PaymentRequest } from "../shared/x402";

// ── Service Type Registry ──────────────────────────────────────────────────

export interface ServiceConfig {
  capabilityTag: string;
  pricingKey: string;
  endpointPath: string;
  buildBody: (input: any, taskId: string) => Record<string, any>;
  displayResult: (result: any) => void;
}

export const SERVICE_REGISTRY: Record<string, ServiceConfig> = {
  translation: {
    capabilityTag: "translation",
    pricingKey: "service-request",
    endpointPath: "/service/request",
    buildBody: (input, taskId) => ({
      text: input.text,
      targetLanguage: input.targetLanguage,
      taskId,
    }),
    displayResult: (result) => {
      console.log(`    Translated: "${result.translatedText}"`);
      console.log(`    Language: ${result.sourceLanguage} -> ${result.targetLanguage}`);
      console.log(`    Words: ${result.wordCount} total, ${result.translatedWords} translated (${result.coverage}% coverage)`);
    },
  },
  summarization: {
    capabilityTag: "summarization",
    pricingKey: "service-request",
    endpointPath: "/service/request",
    buildBody: (input, taskId) => ({
      text: input.text,
      maxLength: input.maxLength,
      taskId,
    }),
    displayResult: (result) => {
      console.log(`    Summary: "${result.summary.slice(0, 100)}${result.summary.length > 100 ? "..." : ""}"`);
      console.log(`    Key Points: ${result.keyPoints.length}`);
      for (const kp of result.keyPoints.slice(0, 3)) {
        console.log(`      - ${kp.slice(0, 80)}${kp.length > 80 ? "..." : ""}`);
      }
      console.log(`    Compression: ${(result.compressionRatio * 100).toFixed(0)}% (${result.originalLength} -> ${result.summaryLength} chars)`);
    },
  },
  "code-review": {
    capabilityTag: "code-review",
    pricingKey: "service-request",
    endpointPath: "/service/request",
    buildBody: (input, taskId) => ({
      code: input.code,
      language: input.language,
      taskId,
    }),
    displayResult: (result) => {
      console.log(`    Score: ${result.overallScore}/10`);
      console.log(`    Lines Analyzed: ${result.linesAnalyzed}`);
      console.log(`    Summary: ${result.summary}`);
      if (result.issues.length > 0) {
        console.log(`    Issues:`);
        for (const issue of result.issues.slice(0, 5)) {
          console.log(`      L${issue.line} [${issue.severity}] ${issue.rule}: ${issue.message}`);
        }
        if (result.issues.length > 5) {
          console.log(`      ... and ${result.issues.length - 5} more`);
        }
      }
    },
  },
};

// ── Setup ──────────────────────────────────────────────────────────────────

const rpcProvider = new ethers.JsonRpcProvider(config.rpcUrl);
const wallet = new ethers.Wallet(config.marketplaceKey, rpcProvider);

const identity       = new ethers.Contract(config.contracts.identity, IDENTITY_REGISTRY_ABI, wallet);
const validation     = new ethers.Contract(config.contracts.validation, VALIDATION_REGISTRY_ABI, wallet);
const reputation     = new ethers.Contract(config.contracts.reputation, REPUTATION_REGISTRY_ABI, wallet);
const escrowContract = new ethers.Contract(config.contracts.escrow, PAYMENT_ESCROW_ABI, wallet);
const usdc           = new ethers.Contract(config.contracts.usdc, USDC_ABI, wallet);

let registered = false;

// ── Retry Helper ──────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (i === maxRetries - 1) throw err;
      console.log(`  ⚠ ${label} failed (attempt ${i + 1}/${maxRetries}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

// ── Core Workflow ──────────────────────────────────────────────────────────

interface RankedProvider {
  wallet: string;
  name: string;
  endpoint: string;
  avgScore: number;
  taskCount: bigint;
}

export interface MarketplaceResult {
  taskId: string;
  serviceType: string;
  provider: { address: string; name: string; endpoint: string };
  serviceResult: any;
  paymentAmount: string;
  reputationScore: number;
}

export async function runServiceRequest(serviceType: string, serviceInput: any): Promise<MarketplaceResult> {
  const svcConfig = SERVICE_REGISTRY[serviceType];
  if (!svcConfig) {
    throw new Error(`Unknown service type: "${serviceType}". Available: ${Object.keys(SERVICE_REGISTRY).join(", ")}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`  MARKETPLACE CLIENT — ${serviceType.toUpperCase()} Request`);
  console.log("=".repeat(60));

  // ── Step 1: Register self ──────────────────────────────────────────
  console.log("\n[Step 1] Registering Marketplace Client...");
  if (!registered) {
    try {
      const existing = await identity.getAgent(wallet.address);
      if (!existing.active) {
        const tx = await identity.registerAgent(
          "MarketplaceClient",
          "http://localhost:3407",
          ["client", "marketplace"]
        );
        await tx.wait();
        console.log("  ✓ Registered as MarketplaceClient");
      } else {
        console.log(`  ✓ Already registered as ${existing.name}`);
      }
      registered = true;
    } catch (err: any) {
      console.error("  ✗ Registration failed:", err.message);
    }
  } else {
    console.log("  ✓ Already registered (cached)");
  }

  // ── Step 2: Discover providers ─────────────────────────────────────
  console.log(`\n[Step 2] Discovering ${serviceType} providers...`);
  const providers = await identity.findByCapability(svcConfig.capabilityTag);
  if (providers.length === 0) {
    throw new Error(`No ${serviceType} providers found in registry`);
  }
  console.log(`  Found ${providers.length} provider(s)`);

  // ── Step 3: Rank by reputation ─────────────────────────────────────
  console.log("\n[Step 3] Ranking providers by reputation...");
  const ranked: RankedProvider[] = [];
  for (const p of providers) {
    const rep = await reputation.getReputation(p.wallet);
    const avg = await reputation.getAverageScore(p.wallet);
    ranked.push({
      wallet: p.wallet,
      name: p.name,
      endpoint: p.endpoint,
      avgScore: Number(avg) / 100,
      taskCount: rep.taskCount,
    });
  }

  ranked.sort((a, b) => {
    if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
    return Number(b.taskCount - a.taskCount);
  });

  for (const r of ranked) {
    const score = r.taskCount > 0n ? `${r.avgScore.toFixed(1)}/5` : "N/A";
    console.log(`  ${r.name} — score: ${score}, tasks: ${r.taskCount}`);
  }

  const chosenProvider = ranked[0];
  console.log(`  ✓ Selected: ${chosenProvider.name}`);

  // ── Step 4: Verify provider is online + get pricing ────────────────
  console.log("\n[Step 4] Verifying provider is online...");
  let paymentAmount: bigint;
  try {
    await withRetry(
      () => axios.get(`${chosenProvider.endpoint}/health`, { timeout: 5000 }),
      "Health check"
    );
    const capRes = await axios.get(`${chosenProvider.endpoint}/capabilities`, { timeout: 3000 });
    paymentAmount = BigInt(capRes.data.pricing[svcConfig.pricingKey]);
    console.log(`  ✓ Online, price: ${ethers.formatUnits(paymentAmount, 6)} USDC`);
  } catch (err: any) {
    throw new Error(`Provider ${chosenProvider.name} is not reachable: ${err.message}`);
  }

  // ── Step 5: Create task on-chain ───────────────────────────────────
  const taskIdRaw = `${serviceType}-${Date.now()}`;
  const taskId = ethers.id(taskIdRaw);
  console.log(`\n[Step 5] Creating task on-chain...`);
  console.log(`  Task: "${taskIdRaw}" → ${taskId.slice(0, 18)}...`);

  await withRetry(async () => {
    const tx = await validation.createTask(
      taskId,
      chosenProvider.wallet,
      `${serviceType} service request`
    );
    await tx.wait();
  }, "Create task");
  console.log("  ✓ Task created");

  // ── Step 6: Deposit USDC into escrow ───────────────────────────────
  console.log(`\n[Step 6] Depositing ${ethers.formatUnits(paymentAmount, 6)} USDC into escrow...`);
  const approveTx = await usdc.approve(config.contracts.escrow, paymentAmount);
  await approveTx.wait();
  const depositTx = await escrowContract.deposit(taskId, chosenProvider.wallet, paymentAmount);
  await depositTx.wait();
  console.log("  ✓ USDC deposited");

  // ── Step 7: x402 flow ─────────────────────────────────────────────
  console.log(`\n[Step 7] x402 flow with ${chosenProvider.name}...`);
  const endpoint = chosenProvider.endpoint + svcConfig.endpointPath;
  const body = svcConfig.buildBody(serviceInput, taskId);

  // Phase 1: Initial request → expect 402
  let paymentInfo: X402PaymentRequest;
  try {
    await axios.post(endpoint, body, { timeout: 10000 });
    throw new Error("Expected 402 but got 200");
  } catch (err: any) {
    if (err.response?.status === 402) {
      paymentInfo = err.response.data.payment;
      console.log(`  ← 402 Payment Required (${ethers.formatUnits(paymentInfo!.amount, 6)} USDC)`);
    } else {
      throw new Error(`Unexpected response: ${err.message}`);
    }
  }

  // Phase 2: Re-request with signed payment proof
  console.log("  → Sending request with payment proof...");
  const proof = await buildPaymentProof({
    taskId,
    txHash: depositTx.hash,
    payer: wallet.address,
    wallet: wallet,
  });

  const response = await withRetry(
    () => axios.post(endpoint, body, {
      headers: { "X-402-Payment-Proof": JSON.stringify(proof) },
      timeout: 30000,
    }),
    "Service request"
  );

  const { result: serviceResult, resultHash } = response.data;
  console.log("  ✓ Service result received!");
  svcConfig.displayResult(serviceResult);

  // ── Step 8: Verify result on-chain ─────────────────────────────────
  console.log(`\n[Step 8] Verifying result on-chain...`);
  const hashMatches = await validation.verifyHash(taskId, resultHash);
  console.log(`  Hash verification: ${hashMatches ? "✓ MATCH" : "✗ MISMATCH"}`);

  if (!hashMatches) {
    await (await validation.disputeResult(taskId)).wait();
    await (await escrowContract.refund(taskId)).wait();
    throw new Error("Result verification failed — payment refunded");
  }

  const verifyTx = await validation.verifyResult(taskId);
  await verifyTx.wait();
  console.log("  ✓ Result verified");

  // ── Step 9: Release payment ────────────────────────────────────────
  console.log(`\n[Step 9] Releasing payment...`);
  const releaseTx = await escrowContract.release(taskId);
  await releaseTx.wait();
  console.log(`  ✓ ${ethers.formatUnits(paymentAmount, 6)} USDC released to ${chosenProvider.name}`);

  // ── Step 10: Reputation feedback ───────────────────────────────────
  console.log(`\n[Step 10] Submitting reputation feedback...`);
  const feedbackTx = await reputation.submitFeedback(
    chosenProvider.wallet,
    taskId,
    5,
    `Excellent ${serviceType} service, verified on-chain`
  );
  await feedbackTx.wait();
  console.log(`  ✓ Rated ${chosenProvider.name}: 5/5`);

  // Ask provider to rate us back
  try {
    await axios.post(`${chosenProvider.endpoint}/feedback`, {
      taskId,
      clientAddress: wallet.address,
    });
    console.log(`  ✓ ${chosenProvider.name} submitted reciprocal feedback`);
  } catch {
    console.log(`  ⚠ Provider feedback request failed`);
  }

  const finalScore = await reputation.getAverageScore(chosenProvider.wallet);
  const reputationScore = Number(finalScore) / 100;

  console.log("\n" + "=".repeat(60));
  console.log("  MARKETPLACE REQUEST COMPLETE");
  console.log("=".repeat(60));
  console.log(`  Service:     ${serviceType}`);
  console.log(`  Provider:    ${chosenProvider.name}`);
  console.log(`  Payment:     ${ethers.formatUnits(paymentAmount, 6)} USDC`);
  console.log(`  Provider Rep: ${reputationScore.toFixed(1)}/5.00`);
  console.log("=".repeat(60) + "\n");

  return {
    taskId,
    serviceType,
    provider: {
      address: chosenProvider.wallet,
      name: chosenProvider.name,
      endpoint: chosenProvider.endpoint,
    },
    serviceResult,
    paymentAmount: ethers.formatUnits(paymentAmount, 6),
    reputationScore,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  const [serviceType, inputJson] = process.argv.slice(2);

  if (!serviceType || !inputJson) {
    console.log("Usage: ts-node agents/marketplace/client.ts <service-type> '<json-input>'");
    console.log("  service-type: translation | summarization | code-review");
    console.log("");
    console.log("Examples:");
    console.log(`  ts-node agents/marketplace/client.ts translation '{"text":"Hello world","targetLanguage":"es"}'`);
    console.log(`  ts-node agents/marketplace/client.ts summarization '{"text":"Long text to summarize."}'`);
    console.log(`  ts-node agents/marketplace/client.ts code-review '{"code":"var x = eval(y)","language":"javascript"}'`);
    process.exit(1);
  }

  let input: any;
  try {
    input = JSON.parse(inputJson);
  } catch {
    console.error("Error: Invalid JSON input");
    process.exit(1);
  }

  runServiceRequest(serviceType, input).catch((err) => {
    console.error("Marketplace request failed:", err.message);
    process.exit(1);
  });
}
