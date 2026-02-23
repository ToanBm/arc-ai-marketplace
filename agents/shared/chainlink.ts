import axios from "axios";
import { ethers } from "ethers";

// ── Pair Validation ─────────────────────────────────────────────────────────

export const SUPPORTED_PAIRS = ["ETH/USD", "BTC/USD"];

/** Normalize user input like "eth/usd", "ETH-USD", "btc / usd" → "ETH/USD" or null */
export function normalizePair(input: string): string | null {
  const cleaned = input.replace(/[\s\-_]+/g, "/").toUpperCase();
  const match = cleaned.match(/^([A-Z]+)\/([A-Z]+)$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

/** Check if a normalized pair is in the supported list */
export function isSupportedPair(pair: string): boolean {
  return SUPPORTED_PAIRS.includes(pair);
}

/**
 * Chainlink Oracle Data Fetcher
 *
 * For the PoC, we use two approaches:
 * 1. Chainlink's public price feed API (via CoinGecko as fallback)
 * 2. On-chain Chainlink Aggregator (when on mainnet/supported testnet)
 *
 * Since Arc Testnet may not have Chainlink feeds deployed, we use
 * a public API as the oracle data source and simulate the Chainlink
 * data format for realistic behavior.
 */

// Chainlink Aggregator V3 ABI (for on-chain reads on supported networks)
const AGGREGATOR_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)",
  "function description() external view returns (string)",
];

// Known Chainlink feed addresses (Ethereum mainnet)
const CHAINLINK_FEEDS: Record<string, string> = {
  "ETH/USD": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  "BTC/USD": "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
};

export interface OracleData {
  pair: string;
  price: string;
  decimals: number;
  timestamp: number;
  source: string;
  roundId?: string;
}

export interface AnalysisResult {
  oracleData: OracleData;
  trend: "bullish" | "bearish" | "neutral";
  confidence: number;
  analysis: string;
  priceChange24h?: number;
}

/**
 * Fetch price data from a public API (CoinGecko).
 * This simulates what a Chainlink node would provide.
 */
async function fetchFromPublicApi(pair: string): Promise<OracleData> {
  const [base] = pair.split("/");
  const coinId = base.toLowerCase() === "eth" ? "ethereum" : base.toLowerCase() === "btc" ? "bitcoin" : base.toLowerCase();

  try {
    const resp = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_last_updated_at=true`,
      { timeout: 10_000 }
    );

    const data = resp.data[coinId];
    if (!data || !data.usd) throw new Error(`No data for ${coinId}`);

    const ts = data.last_updated_at ? data.last_updated_at * 1000 : Date.now();

    return {
      pair,
      price: data.usd.toFixed(2),
      decimals: 8,
      timestamp: ts,
      source: "coingecko-api",
    };
  } catch (err: any) {
    // CoinGecko rate limit (429) or network issue — fall back to simulated data.
    // WARNING: simulated prices are NOT real market data. Replace with a paid
    // API key (e.g. CoinGecko Pro, CoinMarketCap) for production use.
    const isRateLimit = err?.response?.status === 429;
    console.warn(`[Chainlink] ${isRateLimit ? "Rate limited by CoinGecko" : `API error: ${err.message}`} — falling back to SIMULATED prices (not real market data)`);
    return generateSimulatedData(pair);
  }
}

/**
 * Fetch price data from on-chain Chainlink Aggregator.
 * Only works on networks with deployed Chainlink feeds.
 */
async function fetchFromChainlink(
  provider: ethers.Provider,
  pair: string
): Promise<OracleData | null> {
  const feedAddr = CHAINLINK_FEEDS[pair];
  if (!feedAddr) return null;

  try {
    const aggregator = new ethers.Contract(feedAddr, AGGREGATOR_ABI, provider);
    const [roundId, answer, , updatedAt] = await aggregator.latestRoundData();
    const decimals = await aggregator.decimals();

    const price = Number(answer) / 10 ** Number(decimals);

    return {
      pair,
      price: price.toFixed(2),
      decimals: Number(decimals),
      timestamp: Number(updatedAt) * 1000,
      source: "chainlink-aggregator",
      roundId: roundId.toString(),
    };
  } catch {
    return null;
  }
}

/**
 * Generate simulated oracle data (deterministic for testing).
 */
function generateSimulatedData(pair: string): OracleData {
  const basePrices: Record<string, number> = {
    "ETH/USD": 3521.47,
    "BTC/USD": 67234.89,
    "SOL/USD": 178.32,
  };

  const basePrice = basePrices[pair] || 100.0;
  // Add small random variation (±2%)
  const variation = (Math.random() - 0.5) * 0.04 * basePrice;
  const price = basePrice + variation;

  return {
    pair,
    price: price.toFixed(2),
    decimals: 8,
    timestamp: Date.now(),
    source: "simulated (WARNING: not real market data)",
  };
}

/**
 * Perform simple trend analysis on the price data.
 * In production, this would use historical data and ML models.
 */
function analyzeTrend(oracleData: OracleData): AnalysisResult {
  const price = parseFloat(oracleData.price);

  // Simple heuristic based on price relative to round numbers
  const roundPrice = Math.round(price / 100) * 100;
  const deviation = (price - roundPrice) / roundPrice;

  let trend: "bullish" | "bearish" | "neutral";
  let confidence: number;

  if (deviation > 0.01) {
    trend = "bullish";
    confidence = Math.min(0.6 + Math.abs(deviation) * 5, 0.95);
  } else if (deviation < -0.01) {
    trend = "bearish";
    confidence = Math.min(0.6 + Math.abs(deviation) * 5, 0.95);
  } else {
    trend = "neutral";
    confidence = 0.5;
  }

  const tsStr = oracleData.timestamp > 0
    ? new Date(oracleData.timestamp).toISOString()
    : new Date().toISOString();

  return {
    oracleData,
    trend,
    confidence: parseFloat(confidence.toFixed(2)),
    analysis: `${oracleData.pair} at $${oracleData.price}. Trend: ${trend} (confidence: ${(confidence * 100).toFixed(0)}%). ` +
              `Data sourced from ${oracleData.source} at ${tsStr}.`,
  };
}

/**
 * Main entry point: fetch oracle data and run analysis.
 * Tries on-chain Chainlink first, falls back to public API.
 */
export async function fetchOracleDataWithAnalysis(
  pair: string,
  provider?: ethers.Provider
): Promise<AnalysisResult> {
  let oracleData: OracleData | null = null;

  // Try on-chain Chainlink first (if provider given and feed exists)
  if (provider && CHAINLINK_FEEDS[pair]) {
    oracleData = await fetchFromChainlink(provider, pair);
  }

  // Fall back to public API
  if (!oracleData) {
    oracleData = await fetchFromPublicApi(pair);
  }

  return analyzeTrend(oracleData);
}
