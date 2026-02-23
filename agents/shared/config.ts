import * as dotenv from "dotenv";
import { ethers } from "ethers";
dotenv.config();

/**
 * Shared configuration for both agents.
 * Reads contract addresses from environment or uses defaults for local testing.
 */

// Derive treasury address deterministically from private key.
// Eliminates the dual-source-of-truth problem where TREASURY_ADDRESS and
// PRIVATE_KEY_TREASURY could drift out of sync.
const _treasuryKey = process.env.PRIVATE_KEY_TREASURY || "";
const _treasuryAddress = _treasuryKey
  ? new ethers.Wallet(_treasuryKey).address
  : (process.env.TREASURY_ADDRESS || "");

export const config = {
  // Network
  rpcUrl: process.env.ARC_RPC_URL || "http://127.0.0.1:8545",

  // Agent keys
  agentBKey: process.env.PRIVATE_KEY_AGENT_B || "",
  agentCKey: process.env.PRIVATE_KEY_AGENT_C || "",
  agentDKey: process.env.PRIVATE_KEY_AGENT_D || "",
  agentEKey: process.env.PRIVATE_KEY_AGENT_E || "",
  agentFKey: process.env.PRIVATE_KEY_AGENT_F || "",
  agentGKey: process.env.PRIVATE_KEY_AGENT_G || "",
  agentHKey: process.env.PRIVATE_KEY_AGENT_H || "",
  agentIKey: process.env.PRIVATE_KEY_AGENT_I || "",

  // Marketplace client key
  treasuryKey: _treasuryKey,

  // Treasury = marketplace wallet (Option 1 unified model).
  // Address is derived from PRIVATE_KEY_TREASURY — always in sync.
  // Net retained per request = 10% of agent price.
  treasuryAddress: _treasuryAddress,

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
