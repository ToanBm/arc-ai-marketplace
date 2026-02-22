/**
 * Agent D — Translation Service Provider
 *
 * An autonomous AI agent that provides translation services:
 * 1. Registers itself in the ERC-8004 Identity Registry
 * 2. Listens for translation requests via HTTP
 * 3. Implements x402: responds with 402 Payment Required
 * 4. After payment proof, performs translation and delivers result
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
const wallet = new ethers.Wallet(config.agentDKey, provider);

const identity   = new ethers.Contract(config.contracts.identity, IDENTITY_REGISTRY_ABI, wallet);
const validation  = new ethers.Contract(config.contracts.validation, VALIDATION_REGISTRY_ABI, wallet);
const reputation  = new ethers.Contract(config.contracts.reputation, REPUTATION_REGISTRY_ABI, wallet);

const AGENT_D_PRICE = 2_000_000n; // 2 USDC

const app = express();
app.use(express.json());
app.use(requestLogger("Agent D"));
app.use(apiKeyAuth);
app.use(standardLimiter);

// ── Translation Dictionary ─────────────────────────────────────────────────

const DICTIONARIES: Record<string, Record<string, string>> = {
  es: {
    hello: "hola", world: "mundo", good: "bueno", morning: "mañana",
    the: "el", is: "es", a: "un", and: "y", of: "de", to: "a",
    price: "precio", market: "mercado", data: "datos", agent: "agente",
    service: "servicio", payment: "pago", network: "red", blockchain: "cadena de bloques",
    smart: "inteligente", contract: "contrato", token: "ficha", trade: "comercio",
    buy: "comprar", sell: "vender", analysis: "análisis", report: "informe",
    this: "esto", that: "eso", for: "para", with: "con", from: "desde",
    i: "yo", you: "tú", we: "nosotros", they: "ellos",
  },
  fr: {
    hello: "bonjour", world: "monde", good: "bon", morning: "matin",
    the: "le", is: "est", a: "un", and: "et", of: "de", to: "à",
    price: "prix", market: "marché", data: "données", agent: "agent",
    service: "service", payment: "paiement", network: "réseau", blockchain: "chaîne de blocs",
    smart: "intelligent", contract: "contrat", token: "jeton", trade: "commerce",
    buy: "acheter", sell: "vendre", analysis: "analyse", report: "rapport",
    this: "ceci", that: "cela", for: "pour", with: "avec", from: "de",
    i: "je", you: "vous", we: "nous", they: "ils",
  },
  de: {
    hello: "hallo", world: "welt", good: "gut", morning: "morgen",
    the: "das", is: "ist", a: "ein", and: "und", of: "von", to: "zu",
    price: "preis", market: "markt", data: "daten", agent: "agent",
    service: "dienst", payment: "zahlung", network: "netzwerk", blockchain: "blockkette",
    smart: "intelligent", contract: "vertrag", token: "token", trade: "handel",
    buy: "kaufen", sell: "verkaufen", analysis: "analyse", report: "bericht",
    this: "dies", that: "das", for: "für", with: "mit", from: "von",
    i: "ich", you: "du", we: "wir", they: "sie",
  },
  ja: {
    hello: "こんにちは", world: "世界", good: "良い", morning: "朝",
    the: "その", is: "です", a: "一つ", and: "と", of: "の", to: "へ",
    price: "価格", market: "市場", data: "データ", agent: "エージェント",
    service: "サービス", payment: "支払い", network: "ネットワーク", blockchain: "ブロックチェーン",
    smart: "スマート", contract: "契約", token: "トークン", trade: "取引",
    buy: "買う", sell: "売る", analysis: "分析", report: "レポート",
    this: "これ", that: "それ", for: "ために", with: "で", from: "から",
    i: "私", you: "あなた", we: "私たち", they: "彼ら",
  },
  pt: {
    hello: "olá", world: "mundo", good: "bom", morning: "manhã",
    the: "o", is: "é", a: "um", and: "e", of: "de", to: "para",
    price: "preço", market: "mercado", data: "dados", agent: "agente",
    service: "serviço", payment: "pagamento", network: "rede", blockchain: "cadeia de blocos",
    smart: "inteligente", contract: "contrato", token: "ficha", trade: "comércio",
    buy: "comprar", sell: "vender", analysis: "análise", report: "relatório",
    this: "isto", that: "aquilo", for: "para", with: "com", from: "de",
    i: "eu", you: "você", we: "nós", they: "eles",
  },
  it: {
    hello: "ciao", world: "mondo", good: "buono", morning: "mattina",
    the: "il", is: "è", a: "un", and: "e", of: "di", to: "a",
    price: "prezzo", market: "mercato", data: "dati", agent: "agente",
    service: "servizio", payment: "pagamento", network: "rete", blockchain: "catena di blocchi",
    smart: "intelligente", contract: "contratto", token: "gettone", trade: "commercio",
    buy: "comprare", sell: "vendere", analysis: "analisi", report: "rapporto",
    this: "questo", that: "quello", for: "per", with: "con", from: "da",
    i: "io", you: "tu", we: "noi", they: "loro",
  },
  zh: {
    hello: "你好", world: "世界", good: "好", morning: "早晨",
    the: "该", is: "是", a: "一个", and: "和", of: "的", to: "到",
    price: "价格", market: "市场", data: "数据", agent: "代理",
    service: "服务", payment: "付款", network: "网络", blockchain: "区块链",
    smart: "智能", contract: "合约", token: "代币", trade: "交易",
    buy: "购买", sell: "出售", analysis: "分析", report: "报告",
    this: "这个", that: "那个", for: "为了", with: "用", from: "从",
    i: "我", you: "你", we: "我们", they: "他们",
  },
};

function translateText(text: string, targetLanguage: string): { translated: string; wordCount: number; translatedWords: number } {
  const dict = DICTIONARIES[targetLanguage];
  if (!dict) {
    return { translated: text, wordCount: text.split(/\s+/).length, translatedWords: 0 };
  }

  const words = text.split(/\s+/);
  let translatedWords = 0;

  const translated = words.map((word) => {
    const lower = word.toLowerCase().replace(/[^a-z]/g, "");
    const punctuation = word.replace(/[a-zA-Z]/g, "");
    if (dict[lower]) {
      translatedWords++;
      return dict[lower] + punctuation;
    }
    return word;
  }).join(" ");

  return { translated, wordCount: words.length, translatedWords };
}

// ── Endpoints ──────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ agent: "TranslationBot-D", status: "healthy", wallet: wallet.address, stats: getStats() });
});

app.get("/capabilities", (_req: Request, res: Response) => {
  res.json({
    agent: "TranslationBot-D",
    did: `did:erc8004:${wallet.address.toLowerCase()}`,
    capabilities: ["translation", "nlp", "language"],
    supportedLanguages: ["es", "fr", "de", "ja", "pt", "it", "zh"],
    paymentProtocol: "x402",
    pricing: {
      "service-request": AGENT_D_PRICE.toString(),
      currency: "USDC",
      decimals: 6,
    },
  });
});

app.post("/service/request", serviceLimiter, async (req: Request, res: Response) => {
  const { text, targetLanguage, taskId } = req.body;

  if (!text || !targetLanguage || !taskId) {
    res.status(400).json({ error: "Missing 'text', 'targetLanguage', and/or 'taskId'" });
    return;
  }

  const proofHeader = req.headers["x-402-payment-proof"] as string | undefined;

  if (!proofHeader) {
    console.log(`[Agent D] 402 -> translation to ${targetLanguage} (task: ${taskId})`);

    const paymentRequest = buildPaymentRequest({
      taskId,
      payee: wallet.address,
      amount: AGENT_D_PRICE,
      escrowAddress: config.contracts.escrow,
      usdcAddress: config.contracts.usdc,
    });

    res.status(402).json({
      error: "Payment Required",
      message: "x402: Pay to access translation service",
      payment: paymentRequest,
    });
    return;
  }

  console.log(`[Agent D] Received paid translation request (task: ${taskId})`);

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
    const correctAmount = escrowData.amount >= AGENT_D_PRICE;

    if (!isFunded || !correctPayee || !correctAmount) {
      res.status(402).json({ error: "Payment not verified on-chain" });
      return;
    }

    savePaymentProof(taskId, proof.txHash, proof.payer, escrowData.amount.toString());
    markPaymentVerified(taskId);
  } catch (err: any) {
    console.error(`[Agent D] Escrow verification failed:`, err.message);
    res.status(500).json({ error: "Failed to verify payment on-chain", detail: err.message });
    return;
  }

  // Perform translation
  const result = translateText(text, targetLanguage);
  const serviceResult = {
    translatedText: result.translated,
    sourceLanguage: "en",
    targetLanguage,
    wordCount: result.wordCount,
    translatedWords: result.translatedWords,
    coverage: result.wordCount > 0 ? Math.round((result.translatedWords / result.wordCount) * 100) : 0,
    timestamp: Date.now(),
  };

  const resultJson = JSON.stringify(serviceResult);
  const resultHash = ethers.id(resultJson);

  try {
    const tx = await validation.submitResult(taskId, resultHash, `data:json,${resultJson}`);
    await tx.wait();
    console.log(`[Agent D] Proof submitted (hash: ${resultHash.slice(0, 18)}...)`);
    saveServiceResult(taskId, "translation", `${text.slice(0, 50)}... -> ${targetLanguage}`, resultJson, resultHash);
    saveTaskRecord(taskId, proof.payer, "translation");
    updateTaskStatus(taskId, "completed");
  } catch (err: any) {
    console.error(`[Agent D] Failed to submit proof:`, err.message);
    res.status(500).json({ error: "Failed to submit proof on-chain" });
    return;
  }

  res.json({
    status: "delivered",
    taskId,
    result: serviceResult,
    resultHash,
    proofSubmitted: true,
    provider: "TranslationBot-D",
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
    console.log(`[Agent D] Submitted feedback for client ${clientAddress.slice(0, 10)}...: ${score}/5`);
    res.json({ status: "feedback_submitted", score, comment });
  } catch (err: any) {
    console.error(`[Agent D] Feedback error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Startup ────────────────────────────────────────────────────────────────

export async function startAgentD(port?: number) {
  const p = port || config.agentDPort;

  try {
    const existing = await identity.getAgent(wallet.address);
    if (!existing.active) {
      console.log(`[Agent D] Registering in IdentityRegistry...`);
      const tx = await identity.registerAgent(
        "TranslationBot-D",
        `http://localhost:${p}`,
        ["translation", "nlp", "language"]
      );
      await tx.wait();
      console.log(`[Agent D] Registered as TranslationBot-D`);
    } else {
      console.log(`[Agent D] Already registered as ${existing.name}`);
    }
  } catch (err: any) {
    console.error(`[Agent D] Registration error:`, err.message);
  }

  return new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const server = app.listen(p, () => {
      console.log(`[Agent D] Translation Service listening on port ${p}`);
      console.log(`[Agent D] Wallet: ${wallet.address}`);
      console.log(`[Agent D] Pricing: ${ethers.formatUnits(AGENT_D_PRICE, 6)} USDC per request`);
      resolve(server);
    });

    const shutdown = () => {
      console.log(`\n[Agent D] Shutting down gracefully...`);
      server.close(() => { closeDb(); process.exit(0); });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  });
}

if (require.main === module) {
  startAgentD();
}

export { app };
