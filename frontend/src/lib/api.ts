import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3400",
  timeout: 120000,
});

// Stats
export async function fetchStats() {
  const { data } = await api.get("/api/marketplace/stats");
  return data.stats;
}

// Health
export async function fetchHealth() {
  const { data } = await api.get("/api/health");
  return data;
}

// Providers
export async function fetchProviders() {
  const { data } = await api.get("/api/providers");
  return data.providers;
}

export async function fetchProvidersByCapability(capability: string) {
  const { data } = await api.get(`/api/providers/${capability}`);
  return data.providers;
}

// Services
export async function fetchServices() {
  const { data } = await api.get("/api/services");
  return data.services;
}

export async function submitTranslation(input: {
  text: string;
  targetLanguage: string;
  paymentTxHash?: string;
}) {
  const { data } = await api.post("/api/services/translation", input);
  return data;
}

export async function submitSummarization(input: {
  text: string;
  paymentTxHash?: string;
}) {
  const { data } = await api.post("/api/services/summarization", input);
  return data;
}

export async function submitCodeReview(input: {
  code: string;
  language?: string;
  paymentTxHash?: string;
}) {
  const { data } = await api.post("/api/services/code-review", input);
  return data;
}

// Oracle check — triggers Agent A → B/C workflow (no user payment required)
export async function submitOracleCheck(pair: string) {
  const { data } = await api.post("/api/check", { pair });
  return data;
}

// Supported oracle pairs
export async function fetchSupportedPairs() {
  const { data } = await api.get("/api/supported-pairs");
  return data.pairs as string[];
}

// Pricing
export async function fetchPricing() {
  const { data } = await api.get("/api/pricing");
  return data;
}

// Quote — live price from top-ranked provider
export async function fetchQuote(service: string): Promise<{ service: string; provider: string; price: string; amount: string }> {
  const { data } = await api.get(`/api/quote/${service}`);
  return data;
}

// Config
export async function fetchConfig() {
  const { data } = await api.get("/api/config");
  return data;
}

// History
export async function fetchHistory() {
  const { data } = await api.get("/api/history");
  return data.tasks;
}

export async function fetchTaskDetail(taskId: string) {
  const { data } = await api.get(`/api/history/${taskId}`);
  return data;
}
