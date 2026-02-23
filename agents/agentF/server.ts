/**
 * Agent F — Code Review Service Provider
 *
 * An autonomous AI agent that provides code review services:
 * 1. Registers itself in the ERC-8004 Identity Registry
 * 2. Listens for code review requests via HTTP
 * 3. Implements x402: responds with 402 Payment Required
 * 4. After payment proof, performs code analysis and delivers result
 * 5. Submits proof-of-work hash on-chain
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
const wallet = new ethers.Wallet(config.agentFKey, provider);

const identity   = new ethers.Contract(config.contracts.identity, IDENTITY_REGISTRY_ABI, wallet);
const validation  = new ethers.Contract(config.contracts.validation, VALIDATION_REGISTRY_ABI, wallet);
const reputation  = new ethers.Contract(config.contracts.reputation, REPUTATION_REGISTRY_ABI, wallet);

const AGENT_F_PRICE = 3_000_000n; // 3 USDC

const app = express();
app.use(express.json());
app.use(requestLogger("Agent F"));
app.use(apiKeyAuth);
app.use(standardLimiter);

// ── Code Review Logic ──────────────────────────────────────────────────────

interface CodeIssue {
  line: number;
  severity: "info" | "warning" | "error";
  rule: string;
  message: string;
}

function reviewCode(code: string, language?: string): {
  issues: CodeIssue[];
  overallScore: number;
  linesAnalyzed: number;
  summary: string;
} {
  const lines = code.split("\n");
  const issues: CodeIssue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // console.log detection
    if (/console\.(log|debug|info|warn|error)\s*\(/.test(line)) {
      issues.push({
        line: lineNum,
        severity: "warning",
        rule: "no-console",
        message: "Remove console statement before production",
      });
    }

    // `any` type usage (TypeScript)
    if (/:\s*any\b/.test(line) || /as\s+any\b/.test(line)) {
      issues.push({
        line: lineNum,
        severity: "warning",
        rule: "no-explicit-any",
        message: "Avoid using 'any' type — use a specific type instead",
      });
    }

    // TODO/FIXME/HACK comments
    if (/\/\/\s*(TODO|FIXME|HACK|XXX)\b/i.test(line)) {
      issues.push({
        line: lineNum,
        severity: "info",
        rule: "no-todo-comments",
        message: "Unresolved TODO/FIXME comment found",
      });
    }

    // Magic numbers (numeric literals > 1 outside of common patterns)
    if (/[^a-zA-Z_$]\d{2,}[^a-zA-Z_$xn]/.test(line) && !/(?:port|timeout|delay|size|length|index|0x)/i.test(line) && !/(?:const|let|var)\s+\w+\s*=/.test(line)) {
      // Only flag standalone magic numbers in logic, not declarations
      if (/[+\-*/%><]=?\s*\d{2,}/.test(line) || /\(\d{2,}/.test(line)) {
        issues.push({
          line: lineNum,
          severity: "info",
          rule: "no-magic-numbers",
          message: "Magic number detected — consider using a named constant",
        });
      }
    }

    // Missing error handling (catch with empty body)
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
      issues.push({
        line: lineNum,
        severity: "error",
        rule: "no-empty-catch",
        message: "Empty catch block — errors should be handled or logged",
      });
    }

    // eval() usage
    if (/\beval\s*\(/.test(line)) {
      issues.push({
        line: lineNum,
        severity: "error",
        rule: "no-eval",
        message: "eval() is a security risk — avoid dynamic code execution",
      });
    }

    // var usage (prefer let/const)
    if (/^\s*var\s+/.test(line)) {
      issues.push({
        line: lineNum,
        severity: "warning",
        rule: "no-var",
        message: "Use 'let' or 'const' instead of 'var'",
      });
    }

    // == instead of ===
    if (/[^=!<>]==[^=]/.test(line) && !/===/.test(line)) {
      issues.push({
        line: lineNum,
        severity: "warning",
        rule: "eqeqeq",
        message: "Use strict equality (===) instead of loose equality (==)",
      });
    }
  }

  // Calculate score (1-10)
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;

  let score = 10;
  score -= errorCount * 2;
  score -= warningCount * 1;
  score -= infoCount * 0.3;
  score = Math.max(1, Math.min(10, Math.round(score)));

  const summary = issues.length === 0
    ? "Code looks clean — no issues detected"
    : `Found ${issues.length} issue(s): ${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info`;

  return {
    issues,
    overallScore: score,
    linesAnalyzed: lines.length,
    summary,
  };
}

// ── Endpoints ──────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ agent: "CodeReviewBot-F", status: "healthy", wallet: wallet.address, stats: getStats() });
});

app.get("/capabilities", (_req: Request, res: Response) => {
  res.json({
    agent: "CodeReviewBot-F",
    did: `did:erc8004:${wallet.address.toLowerCase()}`,
    capabilities: ["code-review", "analysis", "security"],
    supportedLanguages: ["javascript", "typescript", "solidity"],
    paymentProtocol: "x402",
    pricing: {
      "service-request": AGENT_F_PRICE.toString(),
      currency: "USDC",
      decimals: 6,
    },
  });
});

app.post("/service/request", serviceLimiter, async (req: Request, res: Response) => {
  const { code, language, taskId } = req.body;

  if (!code || !taskId) {
    res.status(400).json({ error: "Missing 'code' and/or 'taskId'" });
    return;
  }

  const proofHeader = req.headers["x-402-payment-proof"] as string | undefined;

  if (!proofHeader) {
    console.log(`[Agent F] 402 -> code review (task: ${taskId})`);

    const paymentRequest = buildPaymentRequest({
      taskId,
      payee: wallet.address,
      amount: AGENT_F_PRICE,
      escrowAddress: config.contracts.escrow,
      usdcAddress: config.contracts.usdc,
    });

    res.status(402).json({
      error: "Payment Required",
      message: "x402: Pay to access code review service",
      payment: paymentRequest,
    });
    return;
  }

  console.log(`[Agent F] Received paid code review request (task: ${taskId})`);

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
    const correctAmount = escrowData.amount >= AGENT_F_PRICE;

    if (!isFunded || !correctPayee || !correctAmount) {
      res.status(402).json({ error: "Payment not verified on-chain" });
      return;
    }

    savePaymentProof(taskId, proof.txHash, proof.payer, escrowData.amount.toString());
    markPaymentVerified(taskId);
  } catch (err: any) {
    console.error(`[Agent F] Escrow verification failed:`, err.message);
    res.status(500).json({ error: "Failed to verify payment on-chain" });
    return;
  }

  // Perform code review
  const result = reviewCode(code, language);
  const serviceResult = {
    ...result,
    language: language || "auto-detected",
    timestamp: Date.now(),
  };

  const resultJson = JSON.stringify(serviceResult);
  const resultHash = ethers.id(resultJson);

  try {
    const tx = await validation.submitResult(taskId, resultHash, `data:json,${resultJson}`);
    await tx.wait();
    console.log(`[Agent F] Proof submitted (hash: ${resultHash.slice(0, 18)}...)`);
    saveServiceResult(taskId, "code-review", `${code.split("\n").length} lines (${language || "auto"})`, resultJson, resultHash);
    saveTaskRecord(taskId, proof.payer, "code-review");
    updateTaskStatus(taskId, "completed");
  } catch (err: any) {
    console.error(`[Agent F] Failed to submit proof:`, err.message);
    res.status(500).json({ error: "Failed to submit proof on-chain" });
    return;
  }

  res.json({
    status: "delivered",
    taskId,
    result: serviceResult,
    resultHash,
    proofSubmitted: true,
    provider: "CodeReviewBot-F",
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
    console.log(`[Agent F] Submitted feedback for client ${clientAddress.slice(0, 10)}...: ${score}/5`);
    res.json({ status: "feedback_submitted", score, comment });
  } catch (err: any) {
    console.error(`[Agent F] Feedback error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Startup ────────────────────────────────────────────────────────────────

export async function startAgentF(port?: number) {
  const p = port || config.agentFPort;

  try {
    const existing = await identity.getAgent(wallet.address);
    if (!existing.active) {
      console.log(`[Agent F] Registering in IdentityRegistry...`);
      const tx = await identity.registerAgent(
        "CodeReviewBot-F",
        `http://localhost:${p}`,
        ["code-review", "analysis", "security"]
      );
      await tx.wait();
      console.log(`[Agent F] Registered as CodeReviewBot-F`);
    } else {
      console.log(`[Agent F] Already registered as ${existing.name}`);
    }
  } catch (err: any) {
    console.error(`[Agent F] Registration error:`, err.message);
  }

  return new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const server = app.listen(p, () => {
      console.log(`[Agent F] Code Review Service listening on port ${p}`);
      console.log(`[Agent F] Wallet: ${wallet.address}`);
      console.log(`[Agent F] Pricing: ${ethers.formatUnits(AGENT_F_PRICE, 6)} USDC per request`);
      resolve(server);
    });

    const shutdown = () => {
      console.log(`\n[Agent F] Shutting down gracefully...`);
      server.close(() => { closeDb(); process.exit(0); });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  });
}

if (require.main === module) {
  startAgentF();
}

export { app };
