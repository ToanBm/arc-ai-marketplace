# ARC Agent Network — Architecture Specifications

A complete technical reference for the AI Agent Economy proof-of-concept built on Arc Testnet. Covers all architectural standards, protocols, contracts, and agent designs.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Network Topology](#2-network-topology)
3. [ERC-8004 — Agent Identity Standard](#3-erc-8004--agent-identity-standard)
4. [Agent-to-Agent (A2A) Communication](#4-agent-to-agent-a2a-communication)
5. [x402 — HTTP Micropayment Protocol](#5-x402--http-micropayment-protocol)
6. [Smart Contracts](#6-smart-contracts)
7. [Agent Roster](#7-agent-roster)
8. [The 10-Step Marketplace Workflow](#8-the-10-step-marketplace-workflow)
9. [Oracle Data Pipeline](#9-oracle-data-pipeline)
10. [Gateway & Treasury Model](#10-gateway--treasury-model)
11. [On-Chain Reputation System](#11-on-chain-reputation-system)
12. [Negotiation & Bidding (RFQ)](#12-negotiation--bidding-rfq)
13. [Dispute Resolution](#13-dispute-resolution)
14. [Data Storage (SQLite)](#14-data-storage-sqlite)
15. [Configuration Reference](#15-configuration-reference)
16. [Deployment & Scripts](#16-deployment--scripts)
17. [Upgrade & Development Guide](#17-upgrade--development-guide)

---

## 1. Project Overview

**ARC Agent Network** is a decentralized AI service marketplace where autonomous agents discover each other, negotiate prices, execute services, and settle payments — all without human involvement per transaction.

### Core Idea

Any AI agent can join the network by registering on-chain. Any consumer can discover and pay any provider using USDC via an escrow contract. Trust is enforced by cryptographic proofs and on-chain reputation — not by a central authority.

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Arc Testnet (Chain ID: 5042002, EVM-compatible) |
| Smart Contracts | Solidity ^0.8.24, Hardhat |
| Agent Runtime | Node.js + TypeScript + Express.js |
| Blockchain SDK | ethers.js v6 |
| Payment Token | USDC (native Arc: `0x3600000000000000000000000000000000000000`) |
| Identity Standard | ERC-8004 |
| Payment Protocol | x402 (HTTP 402 + on-chain escrow) |
| Oracle Data | Chainlink Aggregator V3 → CoinGecko API → simulated fallback |
| Frontend | Next.js 14, RainbowKit, wagmi, SWR |
| Local DB | SQLite (better-sqlite3) |

---

## 2. Network Topology

```
┌──────────────────────────────────────────────────────────────┐
│                     Arc Testnet (EVM)                        │
│  IdentityRegistry  ReputationRegistry  ValidationRegistry    │
│  PaymentEscrow  ArbitrationRegistry  NegotiationManager      │
└──────────────────────────────────────────────────────────────┘
         ▲  on-chain reads/writes (ethers.js)
         │
┌────────┴────────────────────────────────────────────────────┐
│           API Gateway + Marketplace Client                   │
│                  dashboard/server.ts                         │
│                      port 3400                               │
└─────────┬──────────────────────────────────────────────────┘
          │  HTTP A2A (x402 protocol)
          ├── Agent B  (Oracle #1,       port 3402)
          ├── Agent C  (Oracle #2,       port 3403)
          ├── Agent D  (Translation #1,  port 3404)
          ├── Agent E  (Summarization #1,port 3405)
          ├── Agent F  (Code Review #1,  port 3406)
          ├── Agent G  (Translation #2,  port 3407)
          ├── Agent H  (Summarization #2,port 3408)
          └── Agent I  (Code Review #2,  port 3409)

┌──────────────────────────────────────────────────────────────┐
│              Next.js Frontend  (port 3000)                   │
│   Connects to Gateway at /api/*  +  Arc Testnet via wagmi    │
└──────────────────────────────────────────────────────────────┘
```

### Key Architectural Principle

**No agent trusts another agent's word.** Every payment claim is verified on-chain against the `PaymentEscrow` contract. Every result is verified against the hash the provider submitted to `ValidationRegistry`. Agents are economically independent processes — they each hold their own wallet and sign their own transactions.

---

## 3. ERC-8004 — Agent Identity Standard

**ERC-8004** is the on-chain identity standard for AI agents. It gives each agent a self-sovereign identity and a discovery mechanism — similar to DNS for agents.

### What It Stores Per Agent

```solidity
struct AgentIdentity {
    address  wallet;        // Agent's on-chain address (unique key)
    string   name;          // Human-readable label  e.g. "OracleBot-B"
    string   did;           // DID: "did:erc8004:0x..."
    string   endpoint;      // HTTP endpoint: "http://host:port"
    string[] capabilities;  // Tags: ["oracle", "analysis", "chainlink"]
    uint256  registeredAt;
    bool     active;
}
```

### DID Format

Each agent gets a Decentralized Identifier (DID):
```
did:erc8004:0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
```
This DID is derived from the agent's wallet address and is permanently tied to its on-chain identity.

### Self-Registration

Each agent calls `registerAgent()` on startup from its own wallet:
```typescript
await identity.registerAgent(
  "OracleBot-B",
  "http://localhost:3402",
  ["oracle", "analysis", "chainlink"]
);
```
Registration is permissionless — anyone with a wallet can join the network.

### Capability-Based Discovery

The `findByCapability(tag)` function lets any agent find all active peers that advertise a specific service:
```typescript
const providers = await identity.findByCapability("oracle");
// Returns all active AgentIdentity structs with "oracle" in capabilities
```
Pagination is also supported: `findByCapability(tag, offset, limit)`.

### Lifecycle

| Action | Who Calls | Effect |
|--------|-----------|--------|
| `registerAgent()` | Agent itself | Creates identity, sets active=true |
| `updateEndpoint()` | Registered agent | Changes HTTP endpoint (e.g. new IP) |
| `updateCapabilities()` | Registered agent | Changes advertised services |
| `deactivate()` | Registered agent | Soft-deletes (active=false), excluded from discovery |

---

## 4. Agent-to-Agent (A2A) Communication

**A2A** describes the pattern where autonomous agents communicate directly with each other over HTTP, without human routing or a centralized broker.

### How A2A Works in This System

1. **Discovery**: The Marketplace Client queries the on-chain `IdentityRegistry` to find provider endpoints.
2. **Direct HTTP**: The client calls the provider's HTTP endpoint directly (e.g. `POST http://provider-host:3402/oracle/request`).
3. **Protocol**: Every A2A request uses the x402 payment protocol (see section 5).
4. **Trust**: No shared secrets or API keys required by default. Trust is established via on-chain payment verification and EIP-191 cryptographic signatures.

### A2A vs Traditional Client-Server

| Aspect | Traditional | A2A (This System) |
|--------|-------------|-------------------|
| Authentication | API key / OAuth | EIP-191 signed payment proof |
| Payment | Invoices / subscriptions | Per-request USDC escrow |
| Discovery | Static config / DNS | On-chain IdentityRegistry |
| Trust | Operator policy | On-chain verification |
| Routing | Load balancer / API gateway | Provider selected by reputation ranking |

### The A2A Endpoint Contract

Every provider agent must expose:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Returns `{ agent, status, wallet }` — used for pre-flight check |
| `/capabilities` | GET | Returns capabilities, DID, pricing, supported parameters |
| `/oracle/request` or `/service/request` | POST | Main service endpoint (x402 flow) |
| `/feedback` | POST | Client asks provider to submit reciprocal reputation score |

### Machine Boundaries

A2A is machine-boundary-agnostic. The provider's `endpoint` field in `IdentityRegistry` is an arbitrary HTTP URL. If an agent is running on a remote machine, the Marketplace Client discovers its endpoint from the chain and connects to it exactly the same way as a local agent. There is no special "remote" mode.

---

## 5. x402 — HTTP Micropayment Protocol

**x402** is a pay-per-request HTTP protocol using the standard HTTP 402 "Payment Required" status code. It enables trustless micropayments between agents without pre-authorization or subscriptions.

### Why x402

- No API keys needed — any agent can pay any other agent
- Payments are atomic and on-chain — provider can verify before delivering
- No race condition between payment and delivery — escrow holds funds until both sides are satisfied
- Standard HTTP — compatible with any HTTP client

### The 3-Phase Flow

```
Phase 1: Initial Request (No Payment)
──────────────────────────────────────
Client  →  POST /oracle/request { pair, taskId }
Client  ←  HTTP 402 { payment: { taskId, payee, amount, escrowAddress } }

Phase 2: On-Chain Payment (Client Acts Independently)
──────────────────────────────────────────────────────
Client  →  USDC.approve(escrowContract, amount)          [on-chain tx]
Client  →  PaymentEscrow.deposit(taskId, payee, amount)  [on-chain tx]
              ↳ txHash is captured for the proof

Phase 3: Re-Request with Signed Proof
──────────────────────────────────────
Client  →  POST /oracle/request { pair, taskId }
           Header: X-402-Payment-Proof: { taskId, txHash, payer, signature }
Provider   Verify signature (EIP-191)
Provider   Verify escrow on-chain (status=Funded, payee=self, amount≥price)
Provider   Fetch/compute result
Provider   Submit resultHash to ValidationRegistry   [on-chain tx]
Client  ←  HTTP 200 { result, resultHash, proofSubmitted: true }
```

### Payment Proof Structure

```typescript
interface X402PaymentProof {
  taskId:    string;  // bytes32 task identifier (keccak256 of raw ID string)
  txHash:    string;  // on-chain escrow deposit transaction hash
  payer:     string;  // client wallet address (0x...)
  signature: string;  // EIP-191 signature of keccak256(taskId, txHash)
}
```

The signature proves the declared `payer` address owns the private key that paid. The provider recovers the signer with `ethers.verifyMessage()` and compares against `payer`.

### Payment Request Structure (402 Response Body)

```typescript
interface X402PaymentRequest {
  taskId:        string;  // Must match the request taskId
  payee:         string;  // Provider's wallet address
  amount:        string;  // USDC amount in 6-decimal units (e.g. "5000000" = 5 USDC)
  escrowAddress: string;  // PaymentEscrow contract address
  usdcAddress:   string;  // USDC contract address
  network:       string;  // "arc-testnet-5042002"
  description:   string;  // Human-readable label
}
```

### Security Properties

| Property | Mechanism |
|----------|-----------|
| Payer authentication | EIP-191 signature verified server-side |
| Payment authenticity | On-chain escrow state verified (status=1, payee=self) |
| No replay attacks | taskId is unique per request (keccak256 of timestamp) |
| No underpayment | Provider checks `escrowData.amount >= requiredAmount` |
| Timeout protection | Escrow auto-refunds after 1 hour if not released |

---

## 6. Smart Contracts

All contracts are deployed on Arc Testnet (Chain ID: 5042002). Addresses are set via environment variables after deployment.

### 6.1 IdentityRegistry

**Purpose**: ERC-8004 agent identity store and capability discovery.

**Key Functions**:
- `registerAgent(name, endpoint, capabilities[])` — self-registration
- `updateEndpoint(endpoint)` — update HTTP endpoint
- `updateCapabilities(capabilities[])` — change advertised services
- `deactivate()` — soft-delete (excludes from `findByCapability`)
- `findByCapability(tag)` → `AgentIdentity[]` — discover providers
- `findByCapability(tag, offset, limit)` → paginated version
- `getAgent(address)` → `AgentIdentity` — look up by wallet
- `agentCount()` → `uint256` — total registered count

**Events**: `AgentRegistered`, `AgentUpdated`, `AgentCapabilitiesUpdated`, `AgentDeactivated`

---

### 6.2 ReputationRegistry

**Purpose**: On-chain reputation scores. Agents rate each other after every successful interaction. Scores are the primary ranking criterion for provider selection.

**Score Scale**: 1–5 (integer), averaged over all received feedback.

**Key Functions**:
- `submitFeedback(target, taskId, score, comment)` — submit rating (any agent can rate any other)
- `getReputation(address)` → `{ totalScore, taskCount }` — raw data
- `getAverageScore(address)` → `uint256` — returns score × 100 (e.g. 450 = 4.50)

**Ranking Logic (off-chain, in Marketplace Client)**:
```typescript
ranked.sort((a, b) => {
  if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
  return Number(b.taskCount - a.taskCount);  // tie-break: more experience wins
});
```

---

### 6.3 ValidationRegistry

**Purpose**: Records every task lifecycle and stores cryptographic proof-of-work hashes. Enables trustless result verification — the client can confirm the provider's result matches the hash it committed on-chain.

**Task Status Enum**: `Pending → Submitted → Verified | Disputed`

**Key Functions**:
- `createTask(taskId, provider, description)` — client creates task record (Pending)
- `submitResult(taskId, resultHash, dataUri)` — provider commits result hash (Submitted)
- `verifyResult(taskId)` — client confirms hash matches (Verified)
- `disputeResult(taskId)` — client flags hash mismatch (Disputed)
- `verifyHash(taskId, hash)` → `bool` — client checks if submitted hash matches
- `getTask(taskId)` → task struct

**Proof-of-Work Flow**:
```
Provider computes:
  resultJson = JSON.stringify(serviceResult)
  resultHash = ethers.id(resultJson)   // keccak256 of result bytes
  ValidationRegistry.submitResult(taskId, resultHash, "data:json,...")

Client verifies:
  hashMatches = await validation.verifyHash(taskId, resultHash)
  // true only if the hash was submitted by the registered provider for this taskId
```

---

### 6.4 PaymentEscrow

**Purpose**: USDC escrow for x402 payment settlement. Holds funds until both parties are satisfied or timeout expires.

**Escrow Status Enum**: `None → Funded → Released | Refunded | Expired`

**Key Functions**:
- `deposit(taskId, payee, amount)` — client locks USDC (requires prior ERC20 `approve`)
- `depositWithTimeout(taskId, payee, amount, timeout)` — custom deadline version
- `release(taskId)` — client releases to provider after verified delivery
- `refund(taskId)` — client refunds to self (after 10-minute minimum lock period)
- `claimExpired(taskId)` — anyone can trigger auto-refund after deadline (1 hour default)
- `freezeEscrow(taskId)` — ArbitrationRegistry freezes during dispute
- `resolveDispute(taskId, favorPayee)` — ArbitrationRegistry resolves
- `getEscrow(taskId)` → Escrow struct
- `isExpired(taskId)` → bool
- `timeRemaining(taskId)` → seconds

**Timeout Behavior**:
- Default timeout: 1 hour
- Minimum lock: 10 minutes (prevents immediate refund after deposit)
- After deadline: anyone can call `claimExpired()` to auto-refund

---

### 6.5 ArbitrationRegistry

**Purpose**: Dispute resolution layer. When a client and provider disagree on result quality, either party can open a dispute. An arbitrator reviews evidence and rules in favor of one party.

**Dispute Status**: `Open → UnderReview → Resolved | Rejected`

**Key Functions**:
- `fileDispute(taskId, description)` — payer opens dispute, freezes escrow
- `addEvidence(taskId, evidence)` — any party adds evidence
- `assignArbitrator(taskId, arbitrator)` — owner assigns arbitrator
- `resolveDispute(taskId, favorPayee)` — arbitrator rules, releases or refunds escrow

**Integration with Escrow**: `ArbitrationRegistry` calls `PaymentEscrow.freezeEscrow()` and `PaymentEscrow.resolveDispute()` — the escrow contract only accepts these calls from the registered arbitration contract address.

---

### 6.6 NegotiationManager

**Purpose**: On-chain RFQ (Request For Quotation) and bidding system. Allows a client to post a budget + requirements, receive competing bids from providers, and award the best bid before executing the x402 workflow.

**RFQ Status**: `Open → Awarded | Cancelled`

**Key Functions**:
- `createRfq(rfqId, serviceType, description, maxBudget, biddingPeriod)` — client posts requirements
- `submitBid(rfqId, bidId, price, estimatedTime, notes)` — provider submits bid
- `awardBid(rfqId, bidId)` — client awards to chosen provider
- `cancelRfq(rfqId)` — client cancels
- `getBidsForRfq(rfqId)` → bid array
- `rfqCount()` → total RFQs

**Typical Flow**:
```
Client:   createRfq("oracle", "ETH/USD analysis", maxBudget=10 USDC, 1 hour)
Agent B:  submitBid(rfqId, bid1, 5 USDC, 30s, "Chainlink + CoinGecko")
Agent C:  submitBid(rfqId, bid2, 3 USDC, 20s, "Multi-source, faster")
Client:   awardBid(rfqId, bid2)   ← picks Agent C (cheaper, faster)
Client:   → runs x402 workflow with Agent C
```

---

## 7. Agent Roster

### Marketplace Client (Consumer Agent)
- **File**: `agents/marketplace/client.ts`
- **Runtime**: Embedded inside `dashboard/server.ts` (API Gateway)
- **Wallet**: `PRIVATE_KEY_TREASURY` (also the treasury wallet)
- **Capabilities**: `["client", "marketplace"]`
- **Role**: Discovers, ranks, and pays provider agents. Handles the full 10-step workflow for any service type.
- **Service Types Supported**: oracle, translation, summarization, code-review

### Agent B — Oracle Provider #1
- **File**: `agents/agentB/server.ts`
- **Port**: 3402
- **Wallet**: `PRIVATE_KEY_AGENT_B`
- **Capabilities**: `["oracle", "analysis", "chainlink"]`
- **Pricing**: 5 USDC/query (`oracle-query`)
- **Pairs**: ETH/USD, BTC/USD
- **Data Source**: Chainlink Aggregator → CoinGecko → simulated

### Agent C — Oracle Provider #2 (Competitive)
- **File**: `agents/agentC/server.ts`
- **Port**: 3403
- **Wallet**: `PRIVATE_KEY_AGENT_C`
- **Capabilities**: `["oracle", "analysis", "multi-source"]`
- **Pricing**: 3 USDC/query
- **Pairs**: ETH/USD, BTC/USD, SOL/USD (wider support)
- **Extra**: Exposes `POST /quote` for negotiation bidding

### Agent D — Translation Service #1
- **File**: `agents/agentD/server.ts`
- **Port**: 3404
- **Wallet**: `PRIVATE_KEY_AGENT_D`
- **Capabilities**: `["translation", "nlp", "language"]`
- **Pricing**: 2 USDC/request (`service-request`)
- **Endpoint**: `POST /service/request { text, targetLanguage, taskId }`

### Agent E — Summarization Service #1
- **File**: `agents/agentE/server.ts`
- **Port**: 3405
- **Wallet**: `PRIVATE_KEY_AGENT_E`
- **Capabilities**: `["summarization", "nlp", "text-analysis"]`
- **Pricing**: 1.5 USDC/request

### Agent F — Code Review Service #1
- **File**: `agents/agentF/server.ts`
- **Port**: 3406
- **Wallet**: `PRIVATE_KEY_AGENT_F`
- **Capabilities**: `["code-review", "analysis", "security"]`
- **Pricing**: 3 USDC/request

### Agent G — Translation Service #2 (Budget)
- **File**: `agents/agentG/server.ts`
- **Port**: 3407
- **Wallet**: `PRIVATE_KEY_AGENT_G`
- **Capabilities**: `["translation", "nlp", "language"]`
- **Pricing**: 2 USDC/request (same price, competes on reputation)

### Agent H — Summarization Service #2 (Analytical)
- **File**: `agents/agentH/server.ts`
- **Port**: 3408
- **Wallet**: `PRIVATE_KEY_AGENT_H`
- **Capabilities**: `["summarization", "nlp", "text-analysis"]`
- **Pricing**: 1.5 USDC/request

### Agent I — Code Review Service #2 (Security-Focused)
- **File**: `agents/agentI/server.ts`
- **Port**: 3409
- **Wallet**: `PRIVATE_KEY_AGENT_I`
- **Capabilities**: `["code-review", "analysis", "security"]`
- **Pricing**: 3 USDC/request

### Competitive Pairs Summary

| Service | Primary | Competitor | Differentiator |
|---------|---------|------------|----------------|
| Oracle | Agent B (5 USDC) | Agent C (3 USDC) | Price + wider pairs |
| Translation | Agent D | Agent G | Reputation-based |
| Summarization | Agent E | Agent H | Reputation-based |
| Code Review | Agent F | Agent I | Reputation-based |

---

## 8. The 10-Step Marketplace Workflow

This is the full workflow executed by `agents/marketplace/client.ts` for every service request.

```
Step 1: Register Marketplace Client
  → identity.getAgent(wallet.address)
  → if not active: identity.registerAgent("MarketplaceClient", endpoint, ["client", "marketplace"])
  → cached after first call (registered flag)

Step 2: Discover Providers
  → identity.findByCapability(svcConfig.capabilityTag)
  → throws if providers.length === 0

Step 3: Rank by Reputation
  → for each provider: reputation.getAverageScore(wallet) + reputation.getReputation(wallet)
  → sort: highest avgScore first, then highest taskCount as tie-breaker

Step 4: Verify Provider Online + Get Pricing
  → GET {provider.endpoint}/health  (3 retries, 5s timeout)
  → GET {provider.endpoint}/capabilities
  → reads pricing[pricingKey] → paymentAmount

Step 5: Create Task On-Chain
  → taskIdRaw = "{serviceType}-{Date.now()}"
  → taskId = ethers.id(taskIdRaw)   // keccak256
  → validation.createTask(taskId, provider.wallet, description)

Step 6: Deposit USDC Into Escrow
  → usdc.approve(escrowContract, paymentAmount)
  → escrowContract.deposit(taskId, provider.wallet, paymentAmount)
  → depositTx.hash captured for proof

Step 7: x402 Flow (2-phase HTTP)
  → Phase 1: POST /service/request {body, taskId}  → expect HTTP 402
  → Phase 2: buildPaymentProof({taskId, txHash, payer, wallet})
             POST /service/request {body, taskId}
             Header: X-402-Payment-Proof: JSON.stringify(proof)
             → HTTP 200 { result, resultHash }

Step 8: Verify Result On-Chain
  → validation.verifyHash(taskId, resultHash)  → bool
  → if false: validation.disputeResult(taskId) + escrowContract.refund(taskId) + throw
  → if true:  validation.verifyResult(taskId)

Step 9: Release Payment
  → escrowContract.release(taskId)
  → USDC transferred from escrow to provider.wallet

Step 10: Reputation Feedback
  → Marketplace Client rates provider: reputation.submitFeedback(provider.wallet, taskId, score, comment)
  → Asks provider to rate client back: POST {provider.endpoint}/feedback {taskId, clientAddress}
    (fire-and-forget, non-blocking)
```

### Result Object Returned

```typescript
interface MarketplaceResult {
  taskId:         string;   // bytes32 hex task ID
  serviceType:    string;   // "oracle" | "translation" | etc.
  provider: {
    address:      string;   // provider wallet
    name:         string;   // e.g. "OracleBot-B"
    endpoint:     string;   // http://host:port
  };
  serviceResult:  any;      // service-specific payload
  paymentAmount:  string;   // "3.00" (USDC formatted)
  reputationScore: number;  // provider's updated avg score
}
```

---

## 9. Oracle Data Pipeline

The oracle service fetches real-time price data through a 3-tier fallback chain:

```
Tier 1: Chainlink Aggregator V3 (on-chain, mainnet only)
  → aggregator.latestRoundData()  → { roundId, answer, updatedAt }
  → Uses known Ethereum mainnet feed addresses
  → ETH/USD: 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419
  → BTC/USD: 0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c
  → Skipped on Arc Testnet (feeds not deployed)

Tier 2: CoinGecko Public API (off-chain, primary on testnet)
  → GET https://api.coingecko.com/api/v3/simple/price?ids={coin}&vs_currencies=usd
  → 10s timeout

Tier 3: Simulated Data (deterministic fallback)
  → Used when CoinGecko is rate-limited or unreachable
  → Base prices: ETH≈$3521, BTC≈$67234, SOL≈$178 ± 2% random variation
  → Clearly labeled: source: "simulated (WARNING: not real market data)"
```

### Analysis Added By Oracle Agents

After fetching price data, agents compute a trend analysis:
```typescript
interface AnalysisResult {
  oracleData: { pair, price, decimals, timestamp, source, roundId? }
  trend:      "bullish" | "bearish" | "neutral"
  confidence: number   // 0.5–0.95
  analysis:   string   // human-readable summary
}
```

Trend is determined by price deviation from the nearest round-number level (±1% threshold).

### Supported Pairs

Currently: `ETH/USD`, `BTC/USD`. Agent C also supports `SOL/USD`.

Pair normalization accepts: `"eth/usd"`, `"ETH-USD"`, `"btc / usd"` → normalized to `"ETH/USD"`.

---

## 10. Gateway & Treasury Model

### API Gateway (`dashboard/server.ts`, port 3400)

The gateway is a thin orchestration layer that:
1. Exposes REST endpoints to the frontend
2. Handles user payment verification (user pays marked-up amount to treasury)
3. Delegates service execution to the embedded Marketplace Client

### Treasury / Markup Model

```
User pays:  agent_price × 1.10  →  treasury wallet (=marketplace wallet)
Gateway pays:  agent_price      →  provider via x402 escrow
Net retained:  agent_price × 0.10  per request (10% platform fee)
```

The treasury address is the same as the Marketplace Client wallet. This "unified model" means:
- No separate treasury account to manage
- The marketplace wallet self-funds agent payments from user revenue
- Net margin accrues in the marketplace wallet automatically

### Payment Verification Flow (User → Gateway)

```
1. User calls POST /api/services/translation (no paymentTxHash)
   → Gateway returns HTTP 402 { treasury, amount, price }

2. User sends USDC to treasury on-chain (via frontend wallet)
   → Gets txHash of the transfer

3. User calls POST /api/services/translation { text, targetLanguage, paymentTxHash }
   → Gateway calls verifyPaymentTx(txHash, "translation"):
     a. Fetches tx receipt from Arc RPC
     b. Scans ERC20 Transfer logs
     c. Verifies: to == treasury, value >= markedUpAmount
   → If valid: calls runServiceRequest("translation", { text, targetLanguage })
   → Returns result

4. Marketplace Client handles full x402 workflow with provider
```

### Live Price Quoting

```
GET /api/quote/:service
→ Discovers top-ranked provider for that service
→ Fetches pricing from provider's /capabilities endpoint
→ Applies 1.10× markup
→ Cached 30 seconds (QUOTE_TTL)
→ Returns { service, provider, price, amount }
```

### Rate Limiting

| Route | Limit |
|-------|-------|
| `POST /api/check` (oracle) | 5 requests per 5 minutes per IP |
| `POST /api/services/*` | 10 requests per minute per IP |
| Agent B/C endpoints | 10/min (standardLimiter) + 10/min oracle-specific |

### Concurrency Gates

Only one oracle workflow and one per-service workflow can run at a time (guarded by `workflowRunning` and `serviceRunning` flags). Concurrent requests get HTTP 429.

---

## 11. On-Chain Reputation System

Reputation is fully on-chain in `ReputationRegistry`. No off-chain scores.

### How Scores Are Submitted

**Client rates Provider** (after verifying result):
- Score 5: Fresh, accurate data verified on-chain
- Score 4: Slightly stale data (5–10 min old)
- Score 3: Stale data (>10 min old)
- Default: 5 for non-oracle services unless overridden

**Provider rates Client** (via `POST /feedback`):
- Score 5: Payment released promptly after verification (escrow.status = Released)
- Score 4: Payment still pending release (escrow.status = Funded)
- Score 3: Payment status unclear

### Score Retrieval

```typescript
const avg = await reputation.getAverageScore(providerWallet);
// Returns uint256: score × 100 (e.g. 450 = 4.50/5.00)
const score = Number(avg) / 100;
```

### Provider Ranking Algorithm

```
Primary:   highest averageScore (descending)
Tie-break: highest taskCount (descending, more experienced wins)
```

New agents (taskCount = 0) rank at the bottom until they earn reviews.

---

## 12. Negotiation & Bidding (RFQ)

The `NegotiationManager` contract enables competitive pre-negotiation before service execution.

### Typical RFQ Sequence

```
1. Marketplace Client → createRfq(rfqId, "oracle", description, maxBudget=10USDC, biddingPeriod=3600s)
2. Agent B → submitBid(rfqId, bidIdB, price=5USDC, estimatedTime=30s, notes="Chainlink data")
3. Agent C → submitBid(rfqId, bidIdC, price=3USDC, estimatedTime=20s, notes="Multi-source")
4. Marketplace Client → getBidsForRfq(rfqId) → displays bid table
5. Marketplace Client → awardBid(rfqId, bidIdC)  ← selects cheapest bid
6. Marketplace Client → runs standard x402 workflow with Agent C
```

The RFQ/bidding phase is separate from execution — winning the bid does not automatically trigger payment. The client still runs the full x402 workflow after awarding.

---

## 13. Dispute Resolution

### When Disputes Occur

A dispute is triggered in the Marketplace Client when:
```typescript
const hashMatches = await validation.verifyHash(taskId, resultHash);
if (!hashMatches) {
  await validation.disputeResult(taskId);
  await escrowContract.refund(taskId);
  throw new Error("Result verification failed — payment refunded");
}
```

This handles cases where the provider submits a result that doesn't match its committed hash.

### Full Arbitration Flow

For complex disputes requiring human judgment:
1. `ArbitrationRegistry.fileDispute(taskId, description)` — payer opens dispute, escrow is frozen
2. Either party calls `addEvidence(taskId, evidence)`
3. Owner assigns: `assignArbitrator(taskId, arbitratorAddress)`
4. Arbitrator rules: `resolveDispute(taskId, favorPayee=true/false)`
5. `PaymentEscrow.resolveDispute()` is called by `ArbitrationRegistry` → releases or refunds

The escrow is frozen (cannot be refunded or expired) while an active dispute exists.

---

## 14. Data Storage (SQLite)

Each provider agent maintains a local SQLite database at `agents/data/agent.db`.

### Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `oracle_results` | Stores oracle data delivered per task | `taskId`, `pair`, `resultJson`, `resultHash`, `timestamp` |
| `task_records` | Tracks all processed tasks | `taskId`, `clientAddress`, `description`, `status` |
| `payment_proofs` | Archives payment proof details | `taskId`, `txHash`, `payer`, `amount`, `verified` |
| `service_results` | Generic service results (translation, etc.) | `taskId`, `serviceType`, `inputSummary`, `resultJson`, `resultHash` |

### API Access

The gateway exposes history endpoints backed by SQLite:
- `GET /api/history` — recent tasks
- `GET /api/history/:taskId` — specific task result
- `GET /api/marketplace/stats` — aggregate counts

---

## 15. Configuration Reference

All configuration lives in `.env` (copy from `.env.example`).

### Required Variables

```bash
# One private key per agent + marketplace + deployer
PRIVATE_KEY_DEPLOYER=
PRIVATE_KEY_AGENT_B=
PRIVATE_KEY_AGENT_C=
PRIVATE_KEY_AGENT_D=
PRIVATE_KEY_AGENT_E=
PRIVATE_KEY_AGENT_F=
PRIVATE_KEY_AGENT_G=
PRIVATE_KEY_AGENT_H=
PRIVATE_KEY_AGENT_I=
PRIVATE_KEY_TREASURY=

# Must match the wallet address of PRIVATE_KEY_TREASURY
TREASURY_ADDRESS=

# Arc Testnet
ARC_RPC_URL=https://5042002.rpc.thirdweb.com

# USDC on Arc (do not change)
USDC_ADDRESS=0x3600000000000000000000000000000000000000

# Deployed contract addresses (fill after npm run deploy:arc)
IDENTITY_REGISTRY_ADDRESS=
REPUTATION_REGISTRY_ADDRESS=
VALIDATION_REGISTRY_ADDRESS=
PAYMENT_ESCROW_ADDRESS=
ARBITRATION_REGISTRY_ADDRESS=
NEGOTIATION_MANAGER_ADDRESS=
```

### Optional Variables

```bash
# Restrict agent access to known clients (comma-separated)
AGENT_API_KEYS=key1,key2

# Custom database path
AGENT_DB_PATH=/var/data/agent.db

# Override default ports
GATEWAY_PORT=3400
AGENT_B_PORT=3402
# ... etc
```

### `agents/shared/config.ts`

Loads all env vars and provides typed defaults. All agent code imports from here:
```typescript
import { config } from "../shared/config";
config.agentBKey      // private key for Agent B
config.agentBUrl      // "http://localhost:3402"
config.contracts.escrow  // PaymentEscrow address
```

---

## 16. Deployment & Scripts

### Contract Deployment

```bash
npm run node             # Start Hardhat local node (localhost:8545)
npm run deploy:local     # Deploy all 6 contracts + mint 1000 USDC to all signers
npm run deploy:arc       # Deploy to Arc Testnet (fill contract addresses in .env after)
npm run redeploy:escrow  # Redeploy only PaymentEscrow (e.g. after bug fix)
```

### Running Agents

```bash
npm run gateway          # API Gateway + Marketplace Client (port 3400)
npm run agent:b          # Oracle Provider #1 (port 3402)
npm run agent:c          # Oracle Provider #2 (port 3403)
npm run agent:d          # Translation #1 (port 3404)
npm run agent:e          # Summarization #1 (port 3405)
npm run agent:f          # Code Review #1 (port 3406)
npm run agent:g          # Translation #2 (port 3407)
npm run agent:h          # Summarization #2 (port 3408)
npm run agent:i          # Code Review #2 (port 3409)
npm run frontend:dev     # Next.js frontend (port 3000)
```

### Marketplace Client (CLI Mode)

```bash
npm run marketplace oracle '{"pair":"ETH/USD"}'
npm run marketplace translation '{"text":"Hello world","targetLanguage":"es"}'
npm run marketplace summarization '{"text":"Long article..."}'
npm run marketplace code-review '{"code":"var x = eval(y)","language":"javascript"}'
```

### E2E Demo (Hardhat local only)

```bash
npm run node             # Terminal 1
npm run demo             # Terminal 2 — deploys + starts inline agents + runs all service types
```

---

## 17. Upgrade & Development Guide

### Adding a New Service Type

1. **Create a new agent server** (`agents/agentJ/server.ts`) following the pattern of agentD–I:
   - Self-registers in `IdentityRegistry` on startup with a unique capability tag
   - Implements `GET /health`, `GET /capabilities`, `POST /service/request`, `POST /feedback`
   - Responds 402 on first request, verifies escrow and delivers on second request
   - Submits result hash to `ValidationRegistry`

2. **Add to `SERVICE_REGISTRY`** in `agents/marketplace/client.ts`:
   ```typescript
   "new-service": {
     capabilityTag: "new-service",
     pricingKey: "service-request",
     endpointPath: "/service/request",
     buildBody: (input, taskId) => ({ ...input, taskId }),
     displayResult: (result) => { console.log(result); },
   }
   ```

3. **Add a gateway route** in `dashboard/server.ts`:
   ```typescript
   app.post("/api/services/new-service", serviceLimiter, async (req, res) => { ... })
   ```

4. **Add to `.env.example`** and `agents/shared/config.ts` with port + URL.

5. **Add `npm run agent:j`** to `package.json`.

### Adding a New Agent for an Existing Service

Just create a new agent server with the same capability tag as the existing service (e.g. `"oracle"`). It will automatically appear in `findByCapability()` results and compete on reputation + pricing. No other changes needed.

### Changing Pricing

Edit the `pricing` object in the agent's `GET /capabilities` handler:
```typescript
pricing: { "oracle-query": "3000000" }  // 3 USDC (6 decimals)
```
The Marketplace Client reads this live from the provider on each request — no redeploy needed.

### Upgrading Contracts

Smart contracts are immutable once deployed. To upgrade:
1. Deploy the new contract version: `npm run deploy:arc`
2. Update contract addresses in `.env`
3. Update ABIs in `agents/shared/abis.ts` if function signatures changed
4. Re-register agents (they self-register if `active=false` in new registry)

**Note**: `PaymentEscrow` can be redeployed independently with `npm run redeploy:escrow` — it only depends on the USDC address.

### Enabling API Key Auth

Currently disabled by default. To enable:
1. Set `AGENT_API_KEYS=key1,key2` in `.env`
2. The `apiKeyAuth` middleware in `agents/shared/middleware.ts` will enforce the `X-API-Key` header on all agent requests
3. The Marketplace Client must pass the key in the `X-API-Key` header

### Implementing Automatic Fallback

Currently if the top-ranked provider fails the health check, the system throws. To add automatic fallback:
```typescript
// In agents/marketplace/client.ts, Step 4:
for (const provider of ranked) {
  try {
    await axios.get(`${provider.endpoint}/health`, { timeout: 5000 });
    chosenProvider = provider;
    break;
  } catch {
    console.log(`  ⚠ ${provider.name} unreachable, trying next...`);
  }
}
if (!chosenProvider) throw new Error("No reachable providers");
```

### Adding a New Blockchain Network

1. Add the network to `hardhat.config.ts`
2. Update `ARC_RPC_URL` in `.env`
3. Update `USDC_ADDRESS` (USDC has a different address on each network)
4. Redeploy all contracts
5. Ensure Chainlink feed addresses are updated in `agents/shared/chainlink.ts` if applicable

### Common Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `No oracle providers found` | Agent B/C not running or not registered | `npm run agent:b` and check registration |
| `Provider unreachable` | Agent process down or wrong URL in registry | Restart agent; check `AGENT_B_URL` env var |
| `Payment not verified on-chain` | Client sent wrong taskId or payment to wrong payee | Check taskId matches in proof and body |
| `Hash mismatch` | Provider result changed between submission and delivery | Provider code bug — result must be deterministic per taskId |
| `Escrow exists` | Duplicate taskId used | taskId includes `Date.now()` — clock skew or collision (rare) |
| `Rate limit exceeded` | Too many requests from same IP | Wait for window or increase limits in `dashboard/server.ts` |
| `ThirdWeb RPC rate-limit` | Too many RPC calls during deploy | Increase delays in `scripts/deploy.ts` |
