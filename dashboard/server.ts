import express from "express";
import rateLimit from "express-rate-limit";
import * as path from "path";
import * as fs from "fs";
import axios from "axios";
import { ethers } from "ethers";
import { config } from "../agents/shared/config";
import { IDENTITY_REGISTRY_ABI, REPUTATION_REGISTRY_ABI, USDC_ABI } from "../agents/shared/abis";
import { SUPPORTED_PAIRS, normalizePair, isSupportedPair } from "../agents/shared/chainlink";
import { runServiceRequest, SERVICE_REGISTRY, MarketplaceResult } from "../agents/marketplace/client";
import { getRecentTasks, getServiceResult, getStats } from "../agents/shared/storage";

const PORT = config.gatewayPort;
const LOG_FILE = path.join(__dirname, "..", "agents", "data", "workflow-log.json");

const app = express();
app.use(express.json());

// ── CORS for all /api/* routes ──────────────────────────────────────────────
app.use("/api", (_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Rate limiter: 5 checks per 5 minutes per IP (oracle) ────────────────────
const checkLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded. Max 5 checks per 5 minutes." },
});

// ── Rate limiter: 10 requests per minute per IP (marketplace services) ──────
const serviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded. Max 10 service requests per minute." },
});

// ── Concurrency gates ──────────────────────────────────────────────────────
let workflowRunning = false;
const serviceRunning: Record<string, boolean> = {};

// ── Result cache (60s TTL) ──────────────────────────────────────────────────
const resultCache: Map<string, { result: MarketplaceResult; timestamp: number }> = new Map();
const CACHE_TTL = 60_000;

function getCachedResult(pair: string): MarketplaceResult | null {
  const entry = resultCache.get(pair);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.result;
  if (entry) resultCache.delete(pair);
  return null;
}

// ── Static / existing endpoints ─────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/workflow-log", (_req, res) => {
  try {
    const data = fs.readFileSync(LOG_FILE, "utf-8");
    res.json(JSON.parse(data));
  } catch {
    res.json([]);
  }
});

// ── GET /api/config — expose RPC + contract addresses for auto-connect ──────
app.get("/api/config", (_req, res) => {
  res.json({
    rpcUrl: config.rpcUrl,
    contracts: {
      identity: config.contracts.identity,
      reputation: config.contracts.reputation,
      validation: config.contracts.validation,
      escrow: config.contracts.escrow,
      usdc: config.contracts.usdc,
      arbitration: config.contracts.arbitration,
      negotiation: config.contracts.negotiation,
    },
  });
});

// ERC20 Transfer event signature for on-chain verification
const ERC20_TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

// ── Auto-registration helper ────────────────────────────────────────────────
// Ensures an agent is registered in IdentityRegistry using its own key.
// Safe to call repeatedly — no-ops if already active.
async function ensureRegistered(
  key: string,
  name: string,
  endpoint: string,
  capabilities: string[],
): Promise<void> {
  if (!key) return;
  try {
    const rpc = new ethers.JsonRpcProvider(config.rpcUrl);
    const agentWallet = new ethers.Wallet(key, rpc);
    const identityContract = new ethers.Contract(config.contracts.identity, IDENTITY_REGISTRY_ABI, agentWallet);
    const existing = await identityContract.getAgent(agentWallet.address);
    if (!existing.active) {
      console.log(`[Gateway] ${name} not in registry — auto-registering...`);
      const tx = await identityContract.registerAgent(name, endpoint, capabilities);
      await tx.wait();
      console.log(`[Gateway] ${name} registered (${agentWallet.address})`);
    }
  } catch (err: any) {
    console.warn(`[Gateway] Auto-register ${name} failed:`, err.message);
  }
}

// ── Live quote cache (30s TTL) — avoids repeated RPC calls per service type ──
const quoteCache: Map<string, { amount: bigint; provider: string; price: string; ts: number }> = new Map();
const QUOTE_TTL = 30_000;

// 10% platform markup applied to all user-facing prices.
// User pays: agentPrice * 1.10 → operator wallet (treasury = marketplace wallet).
// Operator pays agent: agentPrice. Net retained: agentPrice * 0.10 per request.
const MARKUP_BPS = 110n; // 110 / 100 = 1.10x

async function getProviderQuote(serviceType: string): Promise<{ amount: bigint; provider: string; price: string } | null> {
  const cached = quoteCache.get(serviceType);
  if (cached && Date.now() - cached.ts < QUOTE_TTL) {
    return { amount: cached.amount, provider: cached.provider, price: cached.price };
  }

  const svcConfig = SERVICE_REGISTRY[serviceType];
  if (!svcConfig) return null;

  try {
    const rpcProvider = new ethers.JsonRpcProvider(config.rpcUrl);
    const identityContract = new ethers.Contract(config.contracts.identity, IDENTITY_REGISTRY_ABI, rpcProvider);
    const reputationContract = new ethers.Contract(config.contracts.reputation, REPUTATION_REGISTRY_ABI, rpcProvider);

    const providers = await identityContract.findByCapability(svcConfig.capabilityTag);
    if (providers.length === 0) return null;

    const ranked: { wallet: string; name: string; endpoint: string; avgScore: number; taskCount: bigint }[] = [];
    for (const p of providers) {
      const avg = await reputationContract.getAverageScore(p.wallet);
      const rep = await reputationContract.getReputation(p.wallet);
      ranked.push({ wallet: p.wallet, name: p.name, endpoint: p.endpoint, avgScore: Number(avg) / 100, taskCount: rep.taskCount });
    }
    ranked.sort((a, b) => b.avgScore !== a.avgScore ? b.avgScore - a.avgScore : Number(b.taskCount - a.taskCount));

    const top = ranked[0];
    const capRes = await axios.get(`${top.endpoint}/capabilities`, { timeout: 3000 });
    const agentAmount = BigInt(capRes.data.pricing[svcConfig.pricingKey]);
    const amount = agentAmount * MARKUP_BPS / 100n; // marked-up amount user must pay
    const price = ethers.formatUnits(amount, 6);

    quoteCache.set(serviceType, { amount, provider: top.name, price, ts: Date.now() });
    return { amount, provider: top.name, price };
  } catch {
    return null;
  }
}

/**
 * Verify a user's USDC payment tx on-chain.
 *
 * Primary:  scan ERC20 Transfer logs (standard EVM tokens).
 * Fallback: balance-change check at the transaction block — handles Arc's native
 *           USDC precompile which does not emit standard Transfer events.
 */
async function verifyPaymentTx(
  txHash: string,
  serviceType: string,
): Promise<{ valid: boolean; error?: string }> {
  const quote = await getProviderQuote(serviceType);
  if (!quote) return { valid: false, error: `Cannot determine price for service: ${serviceType}` };

  const requiredAmount = quote.amount;
  const treasury = config.treasuryAddress.toLowerCase();
  const usdcAddress = config.contracts.usdc.toLowerCase();

  if (!usdcAddress) return { valid: false, error: "USDC contract address not configured" };

  try {
    const rpcProvider = new ethers.JsonRpcProvider(config.rpcUrl);
    const receipt = await rpcProvider.getTransactionReceipt(txHash);
    if (!receipt) return { valid: false, error: "Transaction not found or not yet mined" };
    if (receipt.status !== 1) return { valid: false, error: "Transaction reverted" };

    // ── Primary: standard ERC20 Transfer log scan ──────────────────────────
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== usdcAddress) continue;
      if (log.topics[0] !== ERC20_TRANSFER_TOPIC) continue;
      if (log.topics.length < 3) continue;

      const to = "0x" + log.topics[2].slice(26);
      if (to.toLowerCase() !== treasury) continue;

      const value = BigInt(log.data);
      if (value >= requiredAmount) return { valid: true };
    }

    // ── Fallback: balance-change verification ──────────────────────────────
    // Arc's native USDC precompile does not emit standard EVM Transfer logs.
    // Instead, compare the treasury's USDC balance immediately before and
    // after the transaction's block.
    const usdc = new ethers.Contract(config.contracts.usdc, USDC_ABI, rpcProvider);
    const blockNumber = receipt.blockNumber;

    const [balBefore, balAfter] = await Promise.all([
      usdc.balanceOf(treasury, { blockTag: blockNumber - 1 }),
      usdc.balanceOf(treasury, { blockTag: blockNumber }),
    ]);

    if ((balAfter as bigint) - (balBefore as bigint) >= requiredAmount) {
      return { valid: true };
    }

    return { valid: false, error: "USDC payment to treasury not found or insufficient" };
  } catch (err: any) {
    return { valid: false, error: `Payment verification failed: ${err.message}` };
  }
}

// ── GET /api/pricing — treasury address (kept for backwards compat) ──────────
app.get("/api/pricing", (_req, res) => {
  res.json({ treasury: config.treasuryAddress });
});

// ── GET /api/quote/:service — live price from top-ranked provider ────────────
app.get("/api/quote/:service", async (req, res) => {
  const serviceType = req.params.service;
  if (!SERVICE_REGISTRY[serviceType]) {
    return res.status(404).json({ error: `Unknown service: ${serviceType}` });
  }
  const quote = await getProviderQuote(serviceType);
  if (!quote) {
    return res.status(503).json({ error: "No providers available or unreachable" });
  }
  res.json({ service: serviceType, provider: quote.provider, price: quote.price, amount: quote.amount.toString() });
});

// ── GET /api/supported-pairs ────────────────────────────────────────────────
app.get("/api/supported-pairs", (_req, res) => {
  res.json({ pairs: SUPPORTED_PAIRS });
});

// ── GET /api/status ─────────────────────────────────────────────────────────
app.get("/api/status", (_req, res) => {
  res.json({ workflowRunning, serviceRunning });
});

// ── GET /api/cost-info ──────────────────────────────────────────────────────
app.get("/api/cost-info", (_req, res) => {
  res.json({
    txnsPerCheck: 8,
    estimatedCost: "~3-5 USDC",
    cacheTtlSeconds: CACHE_TTL / 1000,
    cachedPairs: Array.from(resultCache.entries())
      .filter(([, v]) => Date.now() - v.timestamp < CACHE_TTL)
      .map(([pair]) => pair),
  });
});

// ── GET /api/health ─────────────────────────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // Blockchain RPC
  try {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const network = await provider.getNetwork();
    checks.blockchain = { ok: true, detail: `chainId ${network.chainId}` };
  } catch (err: any) {
    checks.blockchain = { ok: false, detail: err.message };
  }

  // Contracts (identity.agentCount)
  try {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const identity = new ethers.Contract(config.contracts.identity, IDENTITY_REGISTRY_ABI, provider);
    const count = await identity.agentCount();
    checks.contracts = { ok: true, detail: `${count} agents registered` };
  } catch (err: any) {
    checks.contracts = { ok: false, detail: err.message };
  }

  // Agent B
  try {
    await axios.get(`${config.agentBUrl}/health`, { timeout: 3000 });
    checks.agentB = { ok: true };
  } catch (err: any) {
    checks.agentB = { ok: false, detail: err.message };
  }

  // Agent C (optional)
  try {
    await axios.get(`${config.agentCUrl}/health`, { timeout: 3000 });
    checks.agentC = { ok: true };
  } catch {
    checks.agentC = { ok: false, detail: "unreachable (optional)" };
  }

  // Agent D (Translation)
  try {
    await axios.get(`${config.agentDUrl}/health`, { timeout: 3000 });
    checks.agentD = { ok: true };
  } catch {
    checks.agentD = { ok: false, detail: "unreachable" };
  }

  // Agent E (Summarization)
  try {
    await axios.get(`${config.agentEUrl}/health`, { timeout: 3000 });
    checks.agentE = { ok: true };
  } catch {
    checks.agentE = { ok: false, detail: "unreachable" };
  }

  // Agent F (Code Review)
  try {
    await axios.get(`${config.agentFUrl}/health`, { timeout: 3000 });
    checks.agentF = { ok: true };
  } catch {
    checks.agentF = { ok: false, detail: "unreachable" };
  }

  // Agent G (Translation #2 — Budget)
  try {
    await axios.get(`${config.agentGUrl}/health`, { timeout: 3000 });
    checks.agentG = { ok: true };
  } catch {
    checks.agentG = { ok: false, detail: "unreachable (optional)" };
  }

  // Agent H (Summarization #2 — Analytical)
  try {
    await axios.get(`${config.agentHUrl}/health`, { timeout: 3000 });
    checks.agentH = { ok: true };
  } catch {
    checks.agentH = { ok: false, detail: "unreachable (optional)" };
  }

  // Agent I (Security Code Review)
  try {
    await axios.get(`${config.agentIUrl}/health`, { timeout: 3000 });
    checks.agentI = { ok: true };
  } catch {
    checks.agentI = { ok: false, detail: "unreachable (optional)" };
  }

  const healthy = checks.blockchain.ok && checks.contracts.ok && checks.agentB.ok;
  res.status(healthy ? 200 : 503).json({ healthy, checks });
});

// ── POST /api/check (oracle workflow) ───────────────────────────────────────
app.post("/api/check", checkLimiter, async (req, res) => {
  const rawPair: string = req.body?.pair || "";

  // 1. Validate pair format (#4)
  const pair = normalizePair(rawPair);
  if (!pair || !isSupportedPair(pair)) {
    return res.status(400).json({
      error: `Unsupported pair "${rawPair}". Supported: ${SUPPORTED_PAIRS.join(", ")}`,
      supportedPairs: SUPPORTED_PAIRS,
    });
  }

  // 2. Check cache (#2)
  const cached = getCachedResult(pair);
  if (cached) {
    return res.json({ result: cached, cached: true });
  }

  // 3. Concurrency gate (#1)
  if (workflowRunning) {
    return res.status(429).json({
      error: "A check is already running. Please wait for it to finish.",
    });
  }

  // 4. Pre-flight health check (#5)
  try {
    await axios.get(`${config.agentBUrl}/health`, { timeout: 3000 });
  } catch {
    return res.status(503).json({
      error: "Agent B is unreachable. Start it with: npm run agent:b",
    });
  }

  // Ensure Agent B is registered in IdentityRegistry before discovery
  await ensureRegistered(
    config.agentBKey,
    "OracleBot-B",
    config.agentBUrl,
    ["oracle", "analysis", "chainlink"],
  );

  // 5. Run workflow
  workflowRunning = true;
  try {
    const result = await runServiceRequest("oracle", { pair });
    resultCache.set(pair, { result, timestamp: Date.now() });
    return res.json({ result, cached: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  } finally {
    workflowRunning = false;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── Marketplace API Routes ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /api/services — List available service types with pricing ────────────
app.get("/api/services", (_req, res) => {
  const services = Object.entries(SERVICE_REGISTRY).map(([type, cfg]) => ({
    type,
    capability: cfg.capabilityTag,
    endpoint: cfg.endpointPath,
    pricingKey: cfg.pricingKey,
  }));
  res.json({ services });
});

// ── GET /api/providers — All registered agents with reputation ──────────────
app.get("/api/providers", async (_req, res) => {
  try {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const identity = new ethers.Contract(config.contracts.identity, IDENTITY_REGISTRY_ABI, provider);
    const reputationContract = new ethers.Contract(config.contracts.reputation, REPUTATION_REGISTRY_ABI, provider);

    const count = Number(await identity.agentCount());
    const agents: any[] = [];

    for (let i = 0; i < count; i++) {
      const addr = await identity.agentList(i);
      const info = await identity.getAgent(addr);
      if (!info.active) continue;

      const avgScore = Number(await reputationContract.getAverageScore(addr)) / 100;
      const rep = await reputationContract.getReputation(addr);

      agents.push({
        address: addr,
        name: info.name,
        endpoint: info.endpoint,
        capabilities: Array.from(info.capabilities),
        reputation: {
          averageScore: avgScore,
          taskCount: Number(rep.taskCount),
        },
      });
    }

    res.json({ providers: agents });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/providers/:capability — Filter providers by capability ─────────
app.get("/api/providers/:capability", async (req, res) => {
  try {
    const capability = req.params.capability;
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const identity = new ethers.Contract(config.contracts.identity, IDENTITY_REGISTRY_ABI, provider);
    const reputationContract = new ethers.Contract(config.contracts.reputation, REPUTATION_REGISTRY_ABI, provider);

    const providers = await identity.findByCapability(capability);
    const agents: any[] = [];

    for (const p of providers) {
      const avgScore = Number(await reputationContract.getAverageScore(p.wallet)) / 100;
      const rep = await reputationContract.getReputation(p.wallet);

      agents.push({
        address: p.wallet,
        name: p.name,
        endpoint: p.endpoint,
        capabilities: Array.from(p.capabilities),
        reputation: {
          averageScore: avgScore,
          taskCount: Number(rep.taskCount),
        },
      });
    }

    res.json({ capability, providers: agents });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/services/translation ──────────────────────────────────────────
app.post("/api/services/translation", serviceLimiter, async (req, res) => {
  const { text, targetLanguage, paymentTxHash } = req.body || {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Missing required field: text (string)" });
  }
  if (!targetLanguage || typeof targetLanguage !== "string") {
    return res.status(400).json({ error: "Missing required field: targetLanguage (string)" });
  }

  // Payment required — user must send marked-up amount to treasury before service executes
  if (!paymentTxHash) {
    const quote = await getProviderQuote("translation");
    return res.status(402).json({
      error: "Payment required",
      treasury: config.treasuryAddress,
      amount: quote?.amount.toString(),
      price: quote?.price,
    });
  }
  const verification = await verifyPaymentTx(paymentTxHash, "translation");
  if (!verification.valid) {
    return res.status(402).json({ error: verification.error });
  }

  if (serviceRunning["translation"]) {
    return res.status(429).json({ error: "A translation request is already running. Please wait." });
  }

  serviceRunning["translation"] = true;
  const translationReset = setTimeout(() => { serviceRunning["translation"] = false; }, 90_000);
  try {
    const result = await runServiceRequest("translation", { text, targetLanguage });
    res.json({
      taskId: result.taskId,
      serviceType: result.serviceType,
      provider: { name: result.provider.name, address: result.provider.address },
      result: result.serviceResult,
      payment: `${result.paymentAmount} USDC`,
      reputationScore: result.reputationScore,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    clearTimeout(translationReset);
    serviceRunning["translation"] = false;
  }
});

// ── POST /api/services/summarization ────────────────────────────────────────
app.post("/api/services/summarization", serviceLimiter, async (req, res) => {
  const { text, paymentTxHash } = req.body || {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Missing required field: text (string)" });
  }

  // Payment required
  if (!paymentTxHash) {
    const quote = await getProviderQuote("summarization");
    return res.status(402).json({
      error: "Payment required",
      treasury: config.treasuryAddress,
      amount: quote?.amount.toString(),
      price: quote?.price,
    });
  }
  const verification = await verifyPaymentTx(paymentTxHash, "summarization");
  if (!verification.valid) {
    return res.status(402).json({ error: verification.error });
  }

  if (serviceRunning["summarization"]) {
    return res.status(429).json({ error: "A summarization request is already running. Please wait." });
  }

  serviceRunning["summarization"] = true;
  const summarizationReset = setTimeout(() => { serviceRunning["summarization"] = false; }, 90_000);
  try {
    const result = await runServiceRequest("summarization", { text });
    res.json({
      taskId: result.taskId,
      serviceType: result.serviceType,
      provider: { name: result.provider.name, address: result.provider.address },
      result: result.serviceResult,
      payment: `${result.paymentAmount} USDC`,
      reputationScore: result.reputationScore,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    clearTimeout(summarizationReset);
    serviceRunning["summarization"] = false;
  }
});

// ── POST /api/services/code-review ──────────────────────────────────────────
app.post("/api/services/code-review", serviceLimiter, async (req, res) => {
  const { code, language, paymentTxHash } = req.body || {};
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "Missing required field: code (string)" });
  }

  // Payment required
  if (!paymentTxHash) {
    const quote = await getProviderQuote("code-review");
    return res.status(402).json({
      error: "Payment required",
      treasury: config.treasuryAddress,
      amount: quote?.amount.toString(),
      price: quote?.price,
    });
  }
  const verification = await verifyPaymentTx(paymentTxHash, "code-review");
  if (!verification.valid) {
    return res.status(402).json({ error: verification.error });
  }

  if (serviceRunning["code-review"]) {
    return res.status(429).json({ error: "A code-review request is already running. Please wait." });
  }

  serviceRunning["code-review"] = true;
  const codeReviewReset = setTimeout(() => { serviceRunning["code-review"] = false; }, 90_000);
  try {
    const result = await runServiceRequest("code-review", { code, language });
    res.json({
      taskId: result.taskId,
      serviceType: result.serviceType,
      provider: { name: result.provider.name, address: result.provider.address },
      result: result.serviceResult,
      payment: `${result.paymentAmount} USDC`,
      reputationScore: result.reputationScore,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    clearTimeout(codeReviewReset);
    serviceRunning["code-review"] = false;
  }
});

// ── GET /api/history — Recent tasks from SQLite ─────────────────────────────
app.get("/api/history", (_req, res) => {
  try {
    const tasks = getRecentTasks();
    res.json({ tasks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/history/:taskId — Specific task result ─────────────────────────
app.get("/api/history/:taskId", (req, res) => {
  try {
    const result = getServiceResult(req.params.taskId);
    if (!result) {
      return res.status(404).json({ error: "Task not found" });
    }
    res.json({
      taskId: result.taskId,
      serviceType: result.serviceType,
      inputSummary: result.inputSummary,
      result: JSON.parse(result.resultJson),
      resultHash: result.resultHash,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/marketplace/stats — Aggregate stats ────────────────────────────
app.get("/api/marketplace/stats", (_req, res) => {
  try {
    const stats = getStats();
    res.json({ stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`API Gateway running at http://localhost:${PORT}`);
  console.log(`  Oracle endpoints:      POST /api/check`);
  console.log(`  Marketplace services:  POST /api/services/{translation,summarization,code-review}`);
  console.log(`  Discovery:             GET  /api/services, /api/providers`);
  console.log(`  History:               GET  /api/history, /api/marketplace/stats`);

  // Best-effort startup registration for all agents.
  // Each agent also registers itself on startup; this is a safety net for
  // cases where an agent's self-registration fails (e.g. after redeploy).
  void (async () => {
    await ensureRegistered(config.agentBKey, "OracleBot-B",          config.agentBUrl, ["oracle", "analysis", "chainlink"]);
    await ensureRegistered(config.agentCKey, "OracleBot-C",          config.agentCUrl, ["oracle", "analysis", "chainlink"]);
    await ensureRegistered(config.agentDKey, "TranslationBot-D",     config.agentDUrl, ["translation"]);
    await ensureRegistered(config.agentEKey, "SummarizationBot-E",   config.agentEUrl, ["summarization"]);
    await ensureRegistered(config.agentFKey, "CodeReviewBot-F",      config.agentFUrl, ["code-review"]);
    await ensureRegistered(config.agentGKey, "TranslationBot-G",     config.agentGUrl, ["translation"]);
    await ensureRegistered(config.agentHKey, "SummarizationBot-H",   config.agentHUrl, ["summarization"]);
    await ensureRegistered(config.agentIKey, "CodeReviewBot-I",      config.agentIUrl, ["code-review"]);
  })();
});
