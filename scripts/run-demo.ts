/**
 * End-to-End Demo Script (Hardhat-native, localhost only)
 *
 * NOTE: This script uses a local TestToken for Hardhat testing only.
 *       On Arc Testnet, real USDC (0x3600000000000000000000000000000000000000) is used.
 *
 * Orchestrates the complete AI Agent Economy workflow:
 * 1. Deploys all contracts (including ArbitrationRegistry + NegotiationManager)
 * 2. Mints test USDC to Marketplace Client
 * 3. Starts Agent B + Agent C (Oracle Provider) servers
 * 4. Runs negotiation flow (RFQ → Bids → Award)
 * 5. Marketplace Client runs service requests (Oracle, Translation, Summarization, Code Review)
 * 6. Demonstrates escrow timeout functionality
 * 7. Prints final state of all registries
 *
 * Usage:
 *   npx hardhat node                                        (terminal 1)
 *   npx hardhat run scripts/run-demo.ts --network localhost  (terminal 2)
 */

import { ethers } from "hardhat";
import { fetchOracleDataWithAnalysis } from "../agents/shared/chainlink";
import { buildPaymentRequest, buildPaymentProof, X402PaymentRequest } from "../agents/shared/x402";
import express from "express";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// ── Deploy All Contracts ───────────────────────────────────────────────────

async function deployContracts(deployer: HardhatEthersSigner) {
  console.log("[Deploy] Deploying contracts...");

  const TestToken = await ethers.getContractFactory("TestToken", deployer);
  const usdc = await TestToken.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  console.log(`  TestToken (USDC): ${await usdc.getAddress()}`);

  const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry", deployer);
  const identity = await IdentityRegistry.deploy();
  await identity.waitForDeployment();
  console.log(`  IdentityRegistry: ${await identity.getAddress()}`);

  const ReputationRegistry = await ethers.getContractFactory("ReputationRegistry", deployer);
  const reputation = await ReputationRegistry.deploy();
  await reputation.waitForDeployment();
  console.log(`  ReputationRegistry: ${await reputation.getAddress()}`);

  const ValidationRegistry = await ethers.getContractFactory("ValidationRegistry", deployer);
  const validation = await ValidationRegistry.deploy();
  await validation.waitForDeployment();
  console.log(`  ValidationRegistry: ${await validation.getAddress()}`);

  const PaymentEscrow = await ethers.getContractFactory("PaymentEscrow", deployer);
  const escrow = await PaymentEscrow.deploy(await usdc.getAddress());
  await escrow.waitForDeployment();
  console.log(`  PaymentEscrow: ${await escrow.getAddress()}`);

  const ArbitrationRegistry = await ethers.getContractFactory("ArbitrationRegistry", deployer);
  const arbitration = await ArbitrationRegistry.deploy(await escrow.getAddress());
  await arbitration.waitForDeployment();
  console.log(`  ArbitrationRegistry: ${await arbitration.getAddress()}`);

  const NegotiationManager = await ethers.getContractFactory("NegotiationManager", deployer);
  const negotiation = await NegotiationManager.deploy();
  await negotiation.waitForDeployment();
  console.log(`  NegotiationManager: ${await negotiation.getAddress()}`);

  return { usdc, identity, reputation, validation, escrow, arbitration, negotiation };
}

// ── Inline Agent Server ──────────────────────────────────────────────────

function createOracleServer(
  agentName: string,
  walletAgent: HardhatEthersSigner,
  contracts: Awaited<ReturnType<typeof deployContracts>>,
  defaultPayment: bigint,
) {
  const app = express();
  app.use(express.json());

  const pendingResults = new Map<string, any>();

  app.get("/health", (_req, res) => {
    res.json({ agent: agentName, status: "healthy" });
  });

  app.get("/capabilities", (_req, res) => {
    res.json({
      agent: agentName,
      capabilities: ["oracle", "analysis"],
      supportedPairs: ["ETH/USD", "BTC/USD"],
      paymentProtocol: "x402",
      pricing: { "oracle-query": defaultPayment.toString(), currency: "USDC", decimals: 6 },
    });
  });

  app.post("/oracle/request", async (req, res) => {
    const { pair, taskId } = req.body;
    if (!pair || !taskId) { res.status(400).json({ error: "Missing pair/taskId" }); return; }

    const proofHeader = req.headers["x-402-payment-proof"] as string | undefined;

    if (!proofHeader) {
      console.log(`  [${agentName}] 402 -> ${pair} (task: ${taskId.slice(0, 18)}...)`);
      const result = await fetchOracleDataWithAnalysis(pair);
      pendingResults.set(taskId, result);

      const payment = buildPaymentRequest({
        taskId,
        payee: walletAgent.address,
        amount: defaultPayment,
        escrowAddress: await contracts.escrow.getAddress(),
        usdcAddress: await contracts.usdc.getAddress(),
      });

      res.status(402).json({ error: "Payment Required", payment });
      return;
    }

    console.log(`  [${agentName}] Delivering oracle data for ${pair}`);

    const escrowData = await contracts.escrow.getEscrow(taskId);
    if (escrowData.status !== 1n) {
      res.status(402).json({ error: "Payment not found on-chain" });
      return;
    }

    let result = pendingResults.get(taskId);
    if (!result) result = await fetchOracleDataWithAnalysis(pair);
    pendingResults.delete(taskId);

    const resultJson = JSON.stringify(result);
    const resultHash = ethers.id(resultJson);

    try {
      const tx = await contracts.validation.connect(walletAgent).submitResult(
        taskId, resultHash, `data:json,${resultJson}`
      );
      await tx.wait();
      console.log(`  [${agentName}] Proof submitted (hash: ${resultHash.slice(0, 18)}...)`);
    } catch (err: any) {
      console.error(`  [${agentName}] Proof submission failed:`, err.message);
    }

    res.json({ status: "delivered", taskId, result, resultHash, proofSubmitted: true });
  });

  app.post("/feedback", async (req, res) => {
    const { taskId, clientAddress, score, comment } = req.body;
    try {
      const tx = await contracts.reputation.connect(walletAgent).submitFeedback(
        clientAddress, taskId, score || 5, comment || "Good client"
      );
      await tx.wait();
      console.log(`  [${agentName}] Feedback submitted for client`);
      res.json({ status: "feedback_submitted" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

// ── Main Demo Flow ─────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  AI Service Marketplace — ERC-8004 + x402 + Chainlink      ║");
  console.log("║  Arc Testnet (Chain ID: 5042002)                            ║");
  console.log("║  Oracle + Translation + Summarization + Code Review         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ── Setup Wallets ────────────────────────────────────────────────────
  const signers = await ethers.getSigners();
  const deployer         = signers[0];
  const walletB          = signers[1];
  const walletC          = signers[2];
  const walletD          = signers[3];
  const walletE          = signers[4];
  const walletF          = signers[5];
  const walletMarketplace = signers[6];
  console.log(`Deployer:                  ${deployer.address}`);
  console.log(`Agent B (Oracle Provider): ${walletB.address}`);
  console.log(`Agent C (Oracle Provider): ${walletC.address}`);
  console.log(`Marketplace Client:        ${walletMarketplace.address}\n`);

  // ── Deploy Contracts ─────────────────────────────────────────────────
  const contracts = await deployContracts(deployer);
  const { usdc, identity, reputation, validation, escrow, negotiation } = contracts;

  // ── Mint Test USDC to Marketplace Client ────────────────────────────
  await (await usdc.mint(walletMarketplace.address, 1_000_000_000n)).wait(); // 1000 USDC
  console.log(`\n[Setup] Minted 1000 USDC to Marketplace Client`);
  console.log(`[Setup] Marketplace Client USDC balance: ${ethers.formatUnits(await usdc.balanceOf(walletMarketplace.address), 6)}`);

  // ── Start Agent B + C Servers ────────────────────────────────────────
  const PORT_B = 3402;
  const PORT_C = 3403;

  const agentBApp = createOracleServer("OracleBot-B", walletB, contracts, 5_000_000n);
  const agentCApp = createOracleServer("OracleBot-C", walletC, contracts, 3_000_000n);

  const serverB = await new Promise<ReturnType<typeof agentBApp.listen>>((resolve) => {
    const s = agentBApp.listen(PORT_B, () => resolve(s));
  });
  const serverC = await new Promise<ReturnType<typeof agentCApp.listen>>((resolve) => {
    const s = agentCApp.listen(PORT_C, () => resolve(s));
  });
  console.log(`[Setup] Agent B server on port ${PORT_B}, Agent C on port ${PORT_C}\n`);

  // ── Register Oracle Provider Agents ─────────────────────────────────
  console.log("[Register] Registering oracle agents in IdentityRegistry...");
  await (await identity.connect(walletB).registerAgent(
    "OracleBot-B", `http://localhost:${PORT_B}`, ["oracle", "analysis", "chainlink"]
  )).wait();
  console.log("  Agent B registered as OracleBot-B (5 USDC/query)");

  await (await identity.connect(walletC).registerAgent(
    "OracleBot-C", `http://localhost:${PORT_C}`, ["oracle", "analysis", "multi-source"]
  )).wait();
  console.log("  Agent C registered as OracleBot-C (3 USDC/query)");

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 1: NEGOTIATION — RFQ + Bids + Award
  // ══════════════════════════════════════════════════════════════════════

  console.log("\n" + "─".repeat(60));
  console.log("  PHASE 1: NEGOTIATION (RFQ + Bids)");
  console.log("─".repeat(60));

  const rfqId = ethers.id(`rfq-oracle-${Date.now()}`);

  console.log("\n[1/3] Marketplace Client creates RFQ for oracle service...");
  await (await negotiation.connect(walletMarketplace).createRfq(
    rfqId, "oracle", "ETH/USD price + trend analysis", 10_000_000n, 3600
  )).wait();
  console.log("  RFQ created (max budget: 10 USDC, 1 hour bidding)");

  console.log("\n[2/3] Providers submit bids...");
  const bidIdB = ethers.id("bid-agent-B");
  await (await negotiation.connect(walletB).submitBid(
    rfqId, bidIdB, 5_000_000n, 30, "Chainlink + CoinGecko aggregated data"
  )).wait();
  console.log("  Agent B bid: 5.00 USDC, 30s delivery");

  const bidIdC = ethers.id("bid-agent-C");
  await (await negotiation.connect(walletC).submitBid(
    rfqId, bidIdC, 3_000_000n, 20, "Multi-source aggregated oracle, faster delivery"
  )).wait();
  console.log("  Agent C bid: 3.00 USDC, 20s delivery");

  // Display bids
  const allBids = await negotiation.getBidsForRfq(rfqId);
  console.log(`\n  ┌─────────────┬────────┬──────────────┐`);
  console.log(`  │ Provider    │ Price  │ Est. Delivery│`);
  console.log(`  ├─────────────┼────────┼──────────────┤`);
  for (const bid of allBids) {
    const price = ethers.formatUnits(bid.price, 6);
    const name = bid.provider === walletB.address ? "OracleBot-B" : "OracleBot-C";
    console.log(`  │ ${name.padEnd(11)} │ ${price.padStart(6)} │ ${bid.estimatedTime.toString().padStart(4)}s        │`);
  }
  console.log(`  └─────────────┴────────┴──────────────┘`);

  console.log("\n[3/3] Marketplace Client awards best bid...");
  // Pick the cheapest bid (Agent C)
  await (await negotiation.connect(walletMarketplace).awardBid(rfqId, bidIdC)).wait();
  console.log("  Awarded to Agent C (3.00 USDC — best price)");

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 2: AI SERVICE MARKETPLACE (Oracle + Translation + Summarization + Code Review)
  // ══════════════════════════════════════════════════════════════════════

  console.log("\n" + "─".repeat(60));
  console.log("  PHASE 2: AI SERVICE MARKETPLACE");
  console.log("─".repeat(60));
  console.log("  Oracle is now part of the Marketplace Client (no Agent A needed)");

  // Get additional signers for marketplace agents
  const axios = (await import("axios")).default;

  console.log(`\n  Agent D (Translation):    ${walletD.address}`);
  console.log(`  Agent E (Summarization):  ${walletE.address}`);
  console.log(`  Agent F (Code Review):    ${walletF.address}`);
  console.log(`  Marketplace Client:       ${walletMarketplace.address}`);

  // Mint USDC to marketplace client
  await (await usdc.mint(walletMarketplace.address, 100_000_000n)).wait(); // 100 USDC
  console.log(`\n  Minted 100 USDC to Marketplace Client`);

  // ── Generic Service Server Factory ────────────────────────────────

  function createServiceServer(
    agentName: string,
    walletAgent: HardhatEthersSigner,
    svcContracts: Awaited<ReturnType<typeof deployContracts>>,
    defaultPayment: bigint,
    processRequest: (body: any) => any,
  ) {
    const svcApp = express();
    svcApp.use(express.json());

    svcApp.get("/health", (_req, res) => {
      res.json({ agent: agentName, status: "healthy" });
    });

    svcApp.get("/capabilities", (_req, res) => {
      res.json({
        agent: agentName,
        paymentProtocol: "x402",
        pricing: { "service-request": defaultPayment.toString(), currency: "USDC", decimals: 6 },
      });
    });

    svcApp.post("/service/request", async (req, res) => {
      const { taskId } = req.body;
      if (!taskId) { res.status(400).json({ error: "Missing taskId" }); return; }

      const proofHeader = req.headers["x-402-payment-proof"] as string | undefined;

      if (!proofHeader) {
        console.log(`  [${agentName}] 402 -> service request (task: ${taskId.slice(0, 18)}...)`);
        const payment = buildPaymentRequest({
          taskId,
          payee: walletAgent.address,
          amount: defaultPayment,
          escrowAddress: await svcContracts.escrow.getAddress(),
          usdcAddress: await svcContracts.usdc.getAddress(),
        });
        res.status(402).json({ error: "Payment Required", payment });
        return;
      }

      console.log(`  [${agentName}] Delivering service result`);

      const escrowCheck = await svcContracts.escrow.getEscrow(taskId);
      if (escrowCheck.status !== 1n) {
        res.status(402).json({ error: "Payment not found on-chain" });
        return;
      }

      const result = processRequest(req.body);
      const resultJson = JSON.stringify(result);
      const resultHash = ethers.id(resultJson);

      try {
        const tx = await svcContracts.validation.connect(walletAgent).submitResult(
          taskId, resultHash, `data:json,${resultJson}`
        );
        await tx.wait();
        console.log(`  [${agentName}] Proof submitted (hash: ${resultHash.slice(0, 18)}...)`);
      } catch (err: any) {
        console.error(`  [${agentName}] Proof submission failed:`, err.message);
      }

      res.json({ status: "delivered", taskId, result, resultHash, proofSubmitted: true });
    });

    svcApp.post("/feedback", async (req, res) => {
      const { taskId, clientAddress } = req.body;
      try {
        const tx = await svcContracts.reputation.connect(walletAgent).submitFeedback(
          clientAddress, taskId, 5, "Good client"
        );
        await tx.wait();
        res.json({ status: "feedback_submitted" });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    return svcApp;
  }

  // ── Translation processor ──
  const translationDict: Record<string, string> = {
    hello: "hola", world: "mundo", the: "el", market: "mercado",
    price: "precio", agent: "agente", service: "servicio", is: "es",
    good: "bueno", data: "datos", blockchain: "cadena de bloques",
  };
  const translationServer = createServiceServer("TranslationBot-D", walletD, contracts, 2_000_000n,
    (body) => {
      const words = (body.text || "").split(/\s+/);
      let translatedWords = 0;
      const translated = words.map((w: string) => {
        const lower = w.toLowerCase().replace(/[^a-z]/g, "");
        if (translationDict[lower]) { translatedWords++; return translationDict[lower]; }
        return w;
      }).join(" ");
      return {
        translatedText: translated, sourceLanguage: "en",
        targetLanguage: body.targetLanguage || "es",
        wordCount: words.length, translatedWords,
        coverage: words.length > 0 ? Math.round((translatedWords / words.length) * 100) : 0,
        timestamp: Date.now(),
      };
    }
  );

  // ── Summarization processor ──
  const summarizationServer = createServiceServer("SummarizationBot-E", walletE, contracts, 1_500_000n,
    (body) => {
      const text = body.text || "";
      const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
      const targetCount = Math.max(1, Math.ceil(sentences.length * 0.3));
      const summary = sentences.slice(0, targetCount).join(" ").trim();
      return {
        summary,
        keyPoints: [sentences[0].trim(), ...(sentences.length > 1 ? [sentences[sentences.length - 1].trim()] : [])],
        compressionRatio: text.length > 0 ? Math.round((1 - summary.length / text.length) * 100) / 100 : 0,
        originalLength: text.length, summaryLength: summary.length,
        timestamp: Date.now(),
      };
    }
  );

  // ── Code review processor ──
  const codeReviewServer = createServiceServer("CodeReviewBot-F", walletF, contracts, 3_000_000n,
    (body) => {
      const code = body.code || "";
      const lines = code.split("\n");
      const issues: any[] = [];
      lines.forEach((line: string, i: number) => {
        if (/console\.(log|debug)\s*\(/.test(line))
          issues.push({ line: i + 1, severity: "warning", rule: "no-console", message: "Remove console statement" });
        if (/:\s*any\b/.test(line))
          issues.push({ line: i + 1, severity: "warning", rule: "no-explicit-any", message: "Avoid 'any' type" });
        if (/\beval\s*\(/.test(line))
          issues.push({ line: i + 1, severity: "error", rule: "no-eval", message: "eval() is a security risk" });
        if (/^\s*var\s+/.test(line))
          issues.push({ line: i + 1, severity: "warning", rule: "no-var", message: "Use let/const instead of var" });
      });
      const errors = issues.filter((i) => i.severity === "error").length;
      const warnings = issues.filter((i) => i.severity === "warning").length;
      let score = Math.max(1, Math.min(10, 10 - errors * 2 - warnings));
      return {
        issues, overallScore: score, linesAnalyzed: lines.length,
        summary: issues.length === 0 ? "No issues found" : `Found ${issues.length} issue(s): ${errors} error(s), ${warnings} warning(s)`,
        language: body.language || "auto-detected", timestamp: Date.now(),
      };
    }
  );

  // Start service servers
  const PORT_D = 3404, PORT_E = 3405, PORT_F = 3406;
  const serverD = await new Promise<ReturnType<typeof translationServer.listen>>((resolve) => {
    const s = translationServer.listen(PORT_D, () => resolve(s));
  });
  const serverE = await new Promise<ReturnType<typeof summarizationServer.listen>>((resolve) => {
    const s = summarizationServer.listen(PORT_E, () => resolve(s));
  });
  const serverF = await new Promise<ReturnType<typeof codeReviewServer.listen>>((resolve) => {
    const s = codeReviewServer.listen(PORT_F, () => resolve(s));
  });
  console.log(`  Service servers: D=${PORT_D}, E=${PORT_E}, F=${PORT_F}`);

  // Register agents D/E/F in IdentityRegistry
  console.log("\n[Register] Registering marketplace agents...");
  await (await identity.connect(walletD).registerAgent(
    "TranslationBot-D", `http://localhost:${PORT_D}`, ["translation", "nlp", "language"]
  )).wait();
  console.log("  Agent D registered as TranslationBot-D (2 USDC/request)");

  await (await identity.connect(walletE).registerAgent(
    "SummarizationBot-E", `http://localhost:${PORT_E}`, ["summarization", "nlp", "text-analysis"]
  )).wait();
  console.log("  Agent E registered as SummarizationBot-E (1.5 USDC/request)");

  await (await identity.connect(walletF).registerAgent(
    "CodeReviewBot-F", `http://localhost:${PORT_F}`, ["code-review", "analysis", "security"]
  )).wait();
  console.log("  Agent F registered as CodeReviewBot-F (3 USDC/request)");

  // Register marketplace client
  await (await identity.connect(walletMarketplace).registerAgent(
    "MarketplaceClient", "http://localhost:3407", ["client", "marketplace"]
  )).wait();
  console.log("  Marketplace Client registered");

  // ── Run 3 Service Requests ────────────────────────────────────────

  const serviceRequests = [
    {
      name: "Oracle Price",
      capability: "oracle",
      endpointPath: "/oracle/request",
      provider: walletB,
      endpoint: `http://localhost:${PORT_B}`,
      payment: 5_000_000n,
      body: { pair: "ETH/USD" },
    },
    {
      name: "Translation",
      capability: "translation",
      endpointPath: "/service/request",
      provider: walletD,
      endpoint: `http://localhost:${PORT_D}`,
      payment: 2_000_000n,
      body: { text: "Hello world the market price is good", targetLanguage: "es" },
    },
    {
      name: "Summarization",
      capability: "summarization",
      endpointPath: "/service/request",
      provider: walletE,
      endpoint: `http://localhost:${PORT_E}`,
      payment: 1_500_000n,
      body: { text: "The blockchain market experienced significant growth. New protocols emerged with innovative features. Decentralized finance continued to evolve rapidly. Smart contracts enabled complex automated workflows. The agent economy represents the next frontier." },
    },
    {
      name: "Code Review",
      capability: "code-review",
      endpointPath: "/service/request",
      provider: walletF,
      endpoint: `http://localhost:${PORT_F}`,
      payment: 3_000_000n,
      body: { code: "var x = 10;\nconsole.log(x);\nvar y: any = eval('x + 1');", language: "typescript" },
    },
  ];

  let lastSvcTaskId = "";
  for (const svc of serviceRequests) {
    console.log(`\n  ── ${svc.name} Service Request ──`);

    const svcTaskIdRaw = `${svc.capability}-${Date.now()}`;
    const svcTaskId = ethers.id(svcTaskIdRaw);
    lastSvcTaskId = svcTaskId;

    // Create task
    await (await validation.connect(walletMarketplace).createTask(
      svcTaskId, svc.provider.address, `${svc.name} service request`
    )).wait();

    // Deposit escrow
    await (await usdc.connect(walletMarketplace).approve(await escrow.getAddress(), svc.payment)).wait();
    const svcDepositTx = await escrow.connect(walletMarketplace).deposit(svcTaskId, svc.provider.address, svc.payment);
    await svcDepositTx.wait();
    console.log(`  Escrowed ${ethers.formatUnits(svc.payment, 6)} USDC`);

    // x402 Phase 1: get 402
    let svcPaymentInfo!: X402PaymentRequest;
    try {
      await axios.post(`${svc.endpoint}${svc.endpointPath}`, { ...svc.body, taskId: svcTaskId });
    } catch (err: any) {
      if (err.response?.status === 402) {
        svcPaymentInfo = err.response.data.payment;
        console.log(`  <- 402 Payment Required`);
      } else {
        console.error(`  Error: ${err.message}`);
        continue;
      }
    }

    // x402 Phase 2: send with proof
    const svcProof = await buildPaymentProof({ taskId: svcTaskId, txHash: svcDepositTx.hash, payer: walletMarketplace.address, wallet: walletMarketplace as any });
    const svcResponse = await axios.post(
      `${svc.endpoint}${svc.endpointPath}`,
      { ...svc.body, taskId: svcTaskId },
      { headers: { "X-402-Payment-Proof": JSON.stringify(svcProof) } }
    );

    const svcResult = svcResponse.data.result;
    const svcResultHash = svcResponse.data.resultHash;

    // Verify & release
    const svcHashMatch = await validation.verifyHash(svcTaskId, svcResultHash);
    if (svcHashMatch) {
      await (await validation.connect(walletMarketplace).verifyResult(svcTaskId)).wait();
      await (await escrow.connect(walletMarketplace).release(svcTaskId)).wait();
      console.log(`  ✓ Verified & released ${ethers.formatUnits(svc.payment, 6)} USDC`);

      // Mutual feedback
      await (await reputation.connect(walletMarketplace).submitFeedback(
        svc.provider.address, svcTaskId, 5, `Excellent ${svc.name.toLowerCase()} service`
      )).wait();
      try {
        await axios.post(`${svc.endpoint}/feedback`, { taskId: svcTaskId, clientAddress: walletMarketplace.address });
      } catch {}
    } else {
      console.log(`  ✗ Hash mismatch — disputing`);
      await (await validation.connect(walletMarketplace).disputeResult(svcTaskId)).wait();
      await (await escrow.connect(walletMarketplace).refund(svcTaskId)).wait();
    }

    // Display result summary
    if (svc.capability === "oracle") {
      console.log(`  Result: ${svcResult.oracleData?.pair} = $${svcResult.oracleData?.price} (${svcResult.trend}, ${((svcResult.confidence ?? 0) * 100).toFixed(0)}% confidence)`);
    } else if (svc.capability === "translation") {
      console.log(`  Result: "${svcResult.translatedText}" (${svcResult.coverage}% coverage)`);
    } else if (svc.capability === "summarization") {
      console.log(`  Result: "${svcResult.summary.slice(0, 80)}..." (${(svcResult.compressionRatio * 100).toFixed(0)}% compression)`);
    } else if (svc.capability === "code-review") {
      console.log(`  Result: Score ${svcResult.overallScore}/10, ${svcResult.issues.length} issue(s)`);
    }
  }

  // ── Final State ──────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  FINAL STATE");
  console.log("=".repeat(60));

  const allWallets: [string, HardhatEthersSigner][] = [
    ["Agent B", walletB], ["Agent C", walletC],
    ["Agent D", walletD], ["Agent E", walletE], ["Agent F", walletF],
    ["Marketplace", walletMarketplace],
  ];

  console.log("\n  USDC Balances:");
  for (const [name, w] of allWallets) {
    const bal = await usdc.balanceOf(w.address);
    console.log(`    ${name.padEnd(14)} ${ethers.formatUnits(bal, 6)} USDC`);
  }

  console.log("\n  Reputation:");
  for (const [name, w] of allWallets) {
    const r = await reputation.getReputation(w.address);
    const score = r.taskCount > 0n ? (Number(r.totalScore) * 100 / Number(r.taskCount) / 100).toFixed(2) : "N/A";
    console.log(`    ${name.padEnd(14)} ${r.taskCount} tasks, avg ${score}/5`);
  }

  const taskData = await validation.getTask(lastSvcTaskId);
  const statusNames = ["Pending", "Submitted", "Verified", "Disputed"];
  console.log(`\n  Phase 2 task status: ${statusNames[Number(taskData.status)]}`);
  console.log(`  Negotiation RFQs: ${await negotiation.rfqCount()}`);

  console.log("\n" + "=".repeat(60));
  console.log("  AI SERVICE MARKETPLACE DEMO COMPLETED SUCCESSFULLY");
  console.log("=".repeat(60) + "\n");

  serverB.close();
  serverC.close();
  serverD.close();
  serverE.close();
  serverF.close();
}

main().catch((err) => {
  console.error("\nDemo failed:", err);
  process.exit(1);
});
