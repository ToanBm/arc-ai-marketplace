import * as dotenv from "dotenv";
dotenv.config();

/**
 * Shared configuration for both agents.
 * Reads contract addresses from environment or uses defaults for local testing.
 */
export const config = {
  // Network
  rpcUrl: process.env.ARC_RPC_URL || "http://127.0.0.1:8545",

  // Agent keys (Hardhat defaults for local testing)
  agentAKey: process.env.PRIVATE_KEY_AGENT_A || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  agentBKey: process.env.PRIVATE_KEY_AGENT_B || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",

  // Agent C key (Hardhat account #2 for local testing)
  agentCKey: process.env.PRIVATE_KEY_AGENT_C || "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",

  // Agent D key (Hardhat account #3) — Translation
  agentDKey: process.env.PRIVATE_KEY_AGENT_D || "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",

  // Agent E key (Hardhat account #4) — Summarization
  agentEKey: process.env.PRIVATE_KEY_AGENT_E || "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",

  // Agent F key (Hardhat account #5) — Code Review
  agentFKey: process.env.PRIVATE_KEY_AGENT_F || "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",

  // Agent G key (Hardhat account #8) — Translation #2 (Budget)
  agentGKey: process.env.PRIVATE_KEY_AGENT_G || "0xdbda1821b80551c9d65939329250132c444b1a8a41f96e2741a64a78cc2c31f0",

  // Agent H key (Hardhat account #9) — Summarization #2 (Analytical)
  agentHKey: process.env.PRIVATE_KEY_AGENT_H || "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",

  // Agent I key (Hardhat account #10) — Security Code Review
  agentIKey: process.env.PRIVATE_KEY_AGENT_I || "0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897",

  // Marketplace client key (Hardhat account #6)
  marketplaceKey: process.env.PRIVATE_KEY_MARKETPLACE || "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",

  // Treasury address for user payments (Hardhat account #7)
  treasuryAddress: process.env.TREASURY_ADDRESS || "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",

  // Contract addresses (set after deployment)
  contracts: {
    usdc:        process.env.USDC_ADDRESS || "",
    identity:    process.env.IDENTITY_REGISTRY_ADDRESS || "",
    reputation:  process.env.REPUTATION_REGISTRY_ADDRESS || "",
    validation:  process.env.VALIDATION_REGISTRY_ADDRESS || "",
    escrow:      process.env.PAYMENT_ESCROW_ADDRESS || "",
    arbitration: process.env.ARBITRATION_REGISTRY_ADDRESS || "",
    negotiation: process.env.NEGOTIATION_MANAGER_ADDRESS || "",
  },

  // Agent B server
  agentBPort: parseInt(process.env.AGENT_B_PORT || "3402"),
  agentBUrl:  process.env.AGENT_B_URL || "http://localhost:3402",

  // Agent C server
  agentCPort: parseInt(process.env.AGENT_C_PORT || "3403"),
  agentCUrl:  process.env.AGENT_C_URL || "http://localhost:3403",

  // Agent D server (Translation)
  agentDPort: parseInt(process.env.AGENT_D_PORT || "3404"),
  agentDUrl:  process.env.AGENT_D_URL || "http://localhost:3404",

  // Agent E server (Summarization)
  agentEPort: parseInt(process.env.AGENT_E_PORT || "3405"),
  agentEUrl:  process.env.AGENT_E_URL || "http://localhost:3405",

  // Agent F server (Code Review)
  agentFPort: parseInt(process.env.AGENT_F_PORT || "3406"),
  agentFUrl:  process.env.AGENT_F_URL || "http://localhost:3406",

  // Agent G server (Translation #2 — Budget)
  agentGPort: parseInt(process.env.AGENT_G_PORT || "3407"),
  agentGUrl:  process.env.AGENT_G_URL || "http://localhost:3407",

  // Agent H server (Summarization #2 — Analytical)
  agentHPort: parseInt(process.env.AGENT_H_PORT || "3408"),
  agentHUrl:  process.env.AGENT_H_URL || "http://localhost:3408",

  // Agent I server (Security Code Review)
  agentIPort: parseInt(process.env.AGENT_I_PORT || "3409"),
  agentIUrl:  process.env.AGENT_I_URL || "http://localhost:3409",

  // Gateway port
  gatewayPort: parseInt(process.env.GATEWAY_PORT || "3400"),

  // Payment defaults
  defaultPaymentUsdc: 5_000_000n, // 5 USDC (6 decimals)
};
