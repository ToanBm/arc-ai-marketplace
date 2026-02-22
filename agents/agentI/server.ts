/**
 * Agent I — Security Code Review Provider
 *
 * Competes with Agent F by offering:
 * - Lower pricing: 2 USDC (vs F's 3 USDC)
 * - Security-focused analysis (vs F's style/quality focus)
 * - CWE identifiers for each finding
 * - Solidity-specific security checks (reentrancy, tx.origin, overflow)
 * - Detects hardcoded secrets, SQL injection, XSS, command injection
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
const wallet = new ethers.Wallet(config.agentIKey, provider);

const identity   = new ethers.Contract(config.contracts.identity, IDENTITY_REGISTRY_ABI, wallet);
const validation  = new ethers.Contract(config.contracts.validation, VALIDATION_REGISTRY_ABI, wallet);
const reputation  = new ethers.Contract(config.contracts.reputation, REPUTATION_REGISTRY_ABI, wallet);

const AGENT_I_PRICE = 2_000_000n; // 2 USDC — 33% cheaper than Agent F's 3 USDC

const app = express();
app.use(express.json());
app.use(requestLogger("Agent I"));
app.use(apiKeyAuth);
app.use(standardLimiter);

// ── Security Review Logic ──────────────────────────────────────────────────

type Severity = "critical" | "high" | "medium" | "low" | "info";

interface SecurityFinding {
  line: number;
  severity: Severity;
  category: string;
  cwe: string;
  message: string;
  remediation: string;
}

interface SecuritySummary {
  findings: SecurityFinding[];
  riskScore: number;         // 0–100 (higher = more risk)
  securityGrade: string;     // A–F
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  linesAnalyzed: number;
  language: string;
  summary: string;
}

// Security rules — each returns a finding or null
type SecurityRule = (line: string, lineNum: number, language: string) => SecurityFinding | null;

const SECURITY_RULES: SecurityRule[] = [

  // ── Injection ──────────────────────────────────────────────────────────

  // SQL injection via string concatenation
  (line, num) => {
    if (/(?:query|sql|execute|exec)\s*[=(+]\s*["'].*\+/.test(line) ||
        /["']\s*\+\s*\w+.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/i.test(line)) {
      return {
        line: num, severity: "critical", category: "Injection",
        cwe: "CWE-89",
        message: "Possible SQL injection via string concatenation",
        remediation: "Use parameterized queries or prepared statements",
      };
    }
    return null;
  },

  // Command injection
  (line, num) => {
    if (/(?:exec|spawn|execSync|spawnSync)\s*\([^)]*(?:req\.|body\.|params\.|query\.)/.test(line)) {
      return {
        line: num, severity: "critical", category: "Injection",
        cwe: "CWE-78",
        message: "Potential command injection — user input passed to shell command",
        remediation: "Validate and sanitize all inputs; avoid shell execution with user data",
      };
    }
    return null;
  },

  // XSS via innerHTML / document.write
  (line, num) => {
    if (/\.innerHTML\s*=/.test(line) || /document\.write\s*\(/.test(line)) {
      return {
        line: num, severity: "high", category: "XSS",
        cwe: "CWE-79",
        message: "Potential XSS via innerHTML or document.write",
        remediation: "Use textContent or sanitize HTML with DOMPurify before inserting",
      };
    }
    return null;
  },

  // eval() usage
  (line, num) => {
    if (/\beval\s*\(/.test(line)) {
      return {
        line: num, severity: "critical", category: "Code Injection",
        cwe: "CWE-95",
        message: "eval() executes arbitrary code — severe security risk",
        remediation: "Replace eval() with JSON.parse() for data, or restructure logic",
      };
    }
    return null;
  },

  // new Function() — similar risk to eval
  (line, num) => {
    if (/new\s+Function\s*\(/.test(line)) {
      return {
        line: num, severity: "high", category: "Code Injection",
        cwe: "CWE-95",
        message: "new Function() constructs executable code dynamically",
        remediation: "Avoid dynamic code construction; use explicit function definitions",
      };
    }
    return null;
  },

  // ── Hardcoded Credentials ──────────────────────────────────────────────

  (line, num) => {
    if (/(?:password|passwd|pwd|secret|api_?key|private_?key|auth_?token)\s*[=:]\s*["'][^"']{4,}["']/i.test(line) &&
        !/(?:env\.|process\.env|getenv|os\.environ|placeholder|example|your_|TODO)/i.test(line)) {
      return {
        line: num, severity: "critical", category: "Hardcoded Secret",
        cwe: "CWE-798",
        message: "Hardcoded credential detected",
        remediation: "Store secrets in environment variables or a secrets manager",
      };
    }
    return null;
  },

  // Private key pattern (hex 64 chars)
  (line, num) => {
    if (/["']0x[0-9a-fA-F]{64}["']/.test(line) && !/(?:hash|bytes|id|topic|zeroes)/i.test(line)) {
      return {
        line: num, severity: "critical", category: "Hardcoded Secret",
        cwe: "CWE-321",
        message: "Hardcoded private key detected (64-char hex)",
        remediation: "Load private keys from environment variables or an HSM, never commit to source",
      };
    }
    return null;
  },

  // ── Cryptography ──────────────────────────────────────────────────────

  // Math.random for security purposes
  (line, num) => {
    if (/Math\.random\s*\(/.test(line) &&
        /(?:token|key|secret|nonce|salt|id|uuid|rand|random)/i.test(line)) {
      return {
        line: num, severity: "high", category: "Weak Randomness",
        cwe: "CWE-338",
        message: "Math.random() is not cryptographically secure",
        remediation: "Use crypto.getRandomValues() or crypto.randomBytes() for security-sensitive values",
      };
    }
    return null;
  },

  // MD5 / SHA1 usage (weak hashing)
  (line, num) => {
    if (/(?:md5|sha1|sha-1)\s*\(/i.test(line) || /createHash\s*\(\s*["'](?:md5|sha1)["']/i.test(line)) {
      return {
        line: num, severity: "medium", category: "Weak Cryptography",
        cwe: "CWE-327",
        message: "Weak hash algorithm (MD5/SHA1) — broken for security use",
        remediation: "Use SHA-256 or stronger; for passwords use bcrypt/argon2",
      };
    }
    return null;
  },

  // ── Authentication & Authorization ────────────────────────────────────

  // JWT without verification
  (line, num) => {
    if (/jwt\.decode\s*\(/.test(line) && !/jwt\.verify\s*\(/.test(line)) {
      return {
        line: num, severity: "high", category: "Broken Authentication",
        cwe: "CWE-347",
        message: "jwt.decode() does not verify signature — use jwt.verify() instead",
        remediation: "Always use jwt.verify() with a secret to validate token integrity",
      };
    }
    return null;
  },

  // ── Solidity-Specific ─────────────────────────────────────────────────

  // tx.origin for auth (Solidity)
  (line, num, lang) => {
    if ((lang === "solidity" || /\bsolidity\b/i.test(lang)) && /tx\.origin/.test(line)) {
      return {
        line: num, severity: "high", category: "Solidity: Auth",
        cwe: "CWE-284",
        message: "tx.origin used for authentication — vulnerable to phishing attacks",
        remediation: "Use msg.sender instead of tx.origin for authorization checks",
      };
    }
    return null;
  },

  // Reentrancy: state changes after external call
  (line, num, lang) => {
    if ((lang === "solidity" || /\bsolidity\b/i.test(lang)) &&
        /\.call\s*\{/.test(line) || /\.transfer\s*\(/.test(line) || /\.send\s*\(/.test(line)) {
      return {
        line: num, severity: "high", category: "Solidity: Reentrancy",
        cwe: "CWE-841",
        message: "External call detected — verify state is updated before calling external contracts",
        remediation: "Follow checks-effects-interactions pattern; consider ReentrancyGuard",
      };
    }
    return null;
  },

  // Solidity unchecked block
  (line, num, lang) => {
    if ((lang === "solidity" || /\bsolidity\b/i.test(lang)) && /\bunchecked\s*\{/.test(line)) {
      return {
        line: num, severity: "medium", category: "Solidity: Arithmetic",
        cwe: "CWE-190",
        message: "unchecked block disables overflow/underflow protection",
        remediation: "Only use unchecked when overflow is mathematically impossible; document reasoning",
      };
    }
    return null;
  },

  // selfdestruct
  (line, num, lang) => {
    if ((lang === "solidity" || /\bsolidity\b/i.test(lang)) && /\bselfdestruct\s*\(/.test(line)) {
      return {
        line: num, severity: "critical", category: "Solidity: Destructible",
        cwe: "CWE-284",
        message: "selfdestruct() can permanently destroy the contract",
        remediation: "Remove selfdestruct or restrict with onlyOwner + multi-sig governance",
      };
    }
    return null;
  },

  // ── General Best Practices ────────────────────────────────────────────

  // Prototype pollution
  (line, num) => {
    if (/Object\.assign\s*\(\s*(?:\w+,\s*)?(?:req\.|body\.|params\.|query\.)/.test(line)) {
      return {
        line: num, severity: "medium", category: "Prototype Pollution",
        cwe: "CWE-1321",
        message: "Object.assign with user input may cause prototype pollution",
        remediation: "Use structured clone or validate/whitelist input properties before merging",
      };
    }
    return null;
  },

  // Path traversal
  (line, num) => {
    if (/(?:readFile|writeFile|readFileSync|writeFileSync|createReadStream)\s*\([^)]*(?:req\.|body\.|params\.|query\.)/.test(line)) {
      return {
        line: num, severity: "high", category: "Path Traversal",
        cwe: "CWE-22",
        message: "File operation with user-controlled path — potential directory traversal",
        remediation: "Resolve and validate paths with path.resolve(); restrict to allowed directories",
      };
    }
    return null;
  },
];

function reviewCode(code: string, language?: string): SecuritySummary {
  const lang = language || "auto";
  const lines = code.split("\n");
  const findings: SecurityFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    for (const rule of SECURITY_RULES) {
      const finding = rule(line, lineNum, lang);
      if (finding) findings.push(finding);
    }
  }

  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount     = findings.filter((f) => f.severity === "high").length;
  const mediumCount   = findings.filter((f) => f.severity === "medium").length;
  const lowCount      = findings.filter((f) => f.severity === "low").length;

  // Risk score: weighted sum, capped at 100
  const riskScore = Math.min(
    100,
    criticalCount * 30 + highCount * 15 + mediumCount * 7 + lowCount * 2,
  );

  // Grade mapping
  let securityGrade: string;
  if (riskScore === 0)      securityGrade = "A";
  else if (riskScore < 15)  securityGrade = "B";
  else if (riskScore < 35)  securityGrade = "C";
  else if (riskScore < 60)  securityGrade = "D";
  else                      securityGrade = "F";

  const summary = findings.length === 0
    ? "No security issues detected — code appears safe"
    : `Found ${findings.length} security issue(s): ${criticalCount} critical, ${highCount} high, ${mediumCount} medium, ${lowCount} low`;

  return {
    findings,
    riskScore,
    securityGrade,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    linesAnalyzed: lines.length,
    language: lang,
    summary,
  };
}

// ── Endpoints ──────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    agent: "SecurityReviewBot-I",
    status: "healthy",
    wallet: wallet.address,
    stats: getStats(),
  });
});

app.get("/capabilities", (_req: Request, res: Response) => {
  res.json({
    agent: "SecurityReviewBot-I",
    did: `did:erc8004:${wallet.address.toLowerCase()}`,
    capabilities: ["code-review", "security", "analysis"],
    supportedLanguages: ["javascript", "typescript", "solidity", "python"],
    paymentProtocol: "x402",
    pricing: {
      "service-request": AGENT_I_PRICE.toString(),
      currency: "USDC",
      decimals: 6,
    },
    differentiators: [
      "Budget pricing (2 USDC vs market average)",
      "Security-focused: injection, XSS, secrets, reentrancy",
      "CWE identifiers for every finding",
      "Solidity-specific checks (reentrancy, tx.origin, selfdestruct)",
      "Risk score (0–100) + security grade (A–F)",
    ],
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
    console.log(`[Agent I] 402 -> security code review (task: ${taskId})`);

    const paymentRequest = buildPaymentRequest({
      taskId,
      payee: wallet.address,
      amount: AGENT_I_PRICE,
      escrowAddress: config.contracts.escrow,
      usdcAddress: config.contracts.usdc,
    });

    res.status(402).json({
      error: "Payment Required",
      message: "x402: Pay to access security code review service",
      payment: paymentRequest,
    });
    return;
  }

  console.log(`[Agent I] Received paid security review request (task: ${taskId})`);

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
    const escrowData = await getEscrowData(taskId);
    const isFunded = escrowData.status === 1n;
    const correctPayee = escrowData.payee.toLowerCase() === wallet.address.toLowerCase();
    const correctAmount = escrowData.amount >= AGENT_I_PRICE;

    if (!isFunded || !correctPayee || !correctAmount) {
      res.status(402).json({ error: "Payment not verified on-chain" });
      return;
    }

    savePaymentProof(taskId, proof.txHash, proof.payer, escrowData.amount.toString());
    markPaymentVerified(taskId);
  } catch (err: any) {
    console.error(`[Agent I] Escrow verification failed:`, err.message);
    res.status(500).json({ error: "Failed to verify payment on-chain" });
    return;
  }

  const result = reviewCode(code, language);
  const serviceResult = { ...result, timestamp: Date.now() };

  const resultJson = JSON.stringify(serviceResult);
  const resultHash = ethers.id(resultJson);

  try {
    const tx = await validation.submitResult(taskId, resultHash, `data:json,${resultJson}`);
    await tx.wait();
    console.log(`[Agent I] Proof submitted (hash: ${resultHash.slice(0, 18)}...)`);
    saveServiceResult(taskId, "code-review", `${code.split("\n").length} lines (${language || "auto"})`, resultJson, resultHash);
    saveTaskRecord(taskId, proof.payer, "code-review");
    updateTaskStatus(taskId, "completed");
  } catch (err: any) {
    console.error(`[Agent I] Failed to submit proof:`, err.message);
    res.status(500).json({ error: "Failed to submit proof on-chain" });
    return;
  }

  res.json({
    status: "delivered",
    taskId,
    result: serviceResult,
    resultHash,
    proofSubmitted: true,
    provider: "SecurityReviewBot-I",
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
  } catch {
    score = 4; comment = "Could not verify escrow status";
  }

  try {
    const tx = await reputation.submitFeedback(clientAddress, taskId, score, comment);
    await tx.wait();
    console.log(`[Agent I] Submitted feedback for client ${clientAddress.slice(0, 10)}...: ${score}/5`);
    res.json({ status: "feedback_submitted", score, comment });
  } catch (err: any) {
    console.error(`[Agent I] Feedback error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Startup ────────────────────────────────────────────────────────────────

export async function startAgentI(port?: number) {
  const p = port || config.agentIPort;

  try {
    const existing = await identity.getAgent(wallet.address);
    if (!existing.active) {
      console.log(`[Agent I] Registering in IdentityRegistry...`);
      const tx = await identity.registerAgent(
        "SecurityReviewBot-I",
        `http://localhost:${p}`,
        ["code-review", "security", "analysis"]
      );
      await tx.wait();
      console.log(`[Agent I] Registered as SecurityReviewBot-I`);
    } else {
      console.log(`[Agent I] Already registered as ${existing.name}`);
    }
  } catch (err: any) {
    console.error(`[Agent I] Registration error:`, err.message);
  }

  return new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const server = app.listen(p, () => {
      console.log(`[Agent I] Security Code Review Service listening on port ${p}`);
      console.log(`[Agent I] Wallet: ${wallet.address}`);
      console.log(`[Agent I] Pricing: ${ethers.formatUnits(AGENT_I_PRICE, 6)} USDC per request`);
      console.log(`[Agent I] Focus: security findings with CWE identifiers`);
      resolve(server);
    });

    const shutdown = () => {
      console.log(`\n[Agent I] Shutting down gracefully...`);
      server.close(() => { closeDb(); process.exit(0); });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  });
}

if (require.main === module) {
  startAgentI();
}

export { app };
