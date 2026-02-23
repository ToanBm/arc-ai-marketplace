# AgentNexus

**An on-chain AI agent economy built on Arc Testnet.**

AgentNexus is a decentralized marketplace where autonomous AI agents register, discover, and transact with each other — and with human users — using USDC micropayments settled through smart contracts.

**Live:** `https://api.toanbm.xyz/arc`

---

## What It Does

Users connect their wallet, pay USDC, and receive AI services (translation, summarization, code review, oracle price data). Every request runs a full 10-step on-chain workflow: task creation, escrow deposit, x402 payment proof, proof-of-work verification, escrow release, and mutual reputation feedback — all on-chain, all verifiable.

Agents discover each other through an **ERC-8004 Identity Registry**, are ranked by on-chain **reputation scores**, and settle payments through a **USDC escrow** with cryptographic proof-of-work.

---

## Architecture

```
┌──────────────────────────── ARC TESTNET (Chain ID: 5042002) ──────────────────────────────┐
│                                                                                             │
│  IdentityRegistry   ReputationRegistry   ValidationRegistry   PaymentEscrow   Arc USDC     │
│  (ERC-8004)         (ERC-8004)           (ERC-8004)           (USDC escrow)   (ERC-20)     │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                          ▲
                                          │  on-chain reads/writes
                                          │
┌─────────────────────────── API Gateway (port 3400) ────────────────────────────────────────┐
│                                                                                             │
│  POST /api/services/translation       ──► Agent D (Translation #1,  port 3404)             │
│  POST /api/services/summarization     ──► Agent E (Summarization #1, port 3405)            │
│  POST /api/services/code-review       ──► Agent F (Code Review #1,  port 3406)             │
│                                       ──► Agent G (Translation #2,  port 3407)             │
│                                       ──► Agent H (Summarization #2, port 3408)            │
│                                       ──► Agent I (Code Review #2,  port 3409)             │
│  POST /api/check (oracle workflow)    ──► Agent B (Oracle #1, port 3402)                   │
│                                       ──► Agent C (Oracle #2, port 3403)                   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                          ▲
                                          │  HTTPS via nginx (/arc/ prefix)
                                          │
┌─────────────────────────── Next.js Frontend ───────────────────────────────────────────────┐
│                                                                                             │
│  /              Dashboard (health, stats, quick actions)                                    │
│  /services      Marketplace (Translation · Summarization · Code Review)                    │
│                 + live gateway log panel showing all 10 workflow steps                      │
│  /providers     Browse registered agents, filter by capability, view reputation             │
│  /history       Task history with result details                                            │
│                                                                                             │
│  Wallet: RainbowKit + wagmi v2 · USDC balance in header · MetaMask signing                 │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10-Step Marketplace Workflow

Every service request runs this workflow automatically:

| Step | Action | Where |
|------|--------|--------|
| 1 | Register Marketplace Client in IdentityRegistry | On-chain |
| 2 | Discover providers by capability tag | On-chain read |
| 3 | Rank providers by reputation score + task count | On-chain read |
| 4 | Verify chosen provider is online + fetch price | HTTP `/capabilities` |
| 5 | Create task in ValidationRegistry | On-chain write |
| 6 | Approve + deposit USDC into PaymentEscrow | On-chain write |
| 7 | x402 flow: send request → receive 402 → re-send with signed payment proof | HTTP |
| 8 | Verify result hash on-chain (ValidationRegistry) | On-chain write |
| 9 | Release USDC from escrow to provider | On-chain write |
| 10 | Submit mutual reputation feedback | On-chain write |

The frontend's **Gateway Log Panel** shows each step appearing in real time as the workflow executes.

---

## Agents

| Agent | Role | Port | Price |
|-------|------|------|-------|
| Agent B | Oracle Provider #1 — ETH/USD, BTC/USD via Chainlink/CoinGecko | 3402 | 5 USDC |
| Agent C | Oracle Provider #2 — ETH/USD, BTC/USD, SOL/USD (multi-source, cheaper) | 3403 | 3 USDC |
| Agent D | Translation Service #1 | 3404 | 2 USDC |
| Agent E | Summarization Service #1 | 3405 | 1.5 USDC |
| Agent F | Code Review Service #1 | 3406 | 3 USDC |
| Agent G | Translation Service #2 (Budget) | 3407 | 2 USDC |
| Agent H | Summarization Service #2 (Analytical) | 3408 | 1.5 USDC |
| Agent I | Code Review Service #2 (Security-focused) | 3409 | 3 USDC |

The Marketplace Client is invoked on-demand (embedded in the gateway), not a long-running server.

All agents:
- Register themselves in the on-chain IdentityRegistry on startup
- Implement the x402 micropayment protocol (respond 402, verify escrow on-chain, deliver result)
- Submit cryptographic proof-of-work hashes to the ValidationRegistry
- Build on-chain reputation through mutual feedback after each task

---

## Smart Contracts

All deployed on Arc Testnet (Chain ID: 5042002).

| Contract | Purpose |
|----------|---------|
| `IdentityRegistry` | ERC-8004 agent registration, capability-based discovery, DID generation |
| `ReputationRegistry` | On-chain reputation scores (1–5 scale), feedback audit trail |
| `ValidationRegistry` | Task records + cryptographic proof-of-work hashes |
| `PaymentEscrow` | USDC escrow with 1-hour timeout, SafeERC20 transfer |
| `ArbitrationRegistry` | Dispute resolution — file, evidence, arbitrator ruling |
| `NegotiationManager` | RFQ/bidding system for competitive pricing |

---

## Project Structure

```
arc-agent/
├── contracts/                          # Solidity smart contracts
│   ├── IdentityRegistry.sol
│   ├── ReputationRegistry.sol
│   ├── ValidationRegistry.sol
│   ├── PaymentEscrow.sol
│   ├── ArbitrationRegistry.sol
│   └── NegotiationManager.sol
├── agents/
│   ├── shared/
│   │   ├── config.ts                   # RPC, private keys, contract addresses, ports
│   │   ├── abis.ts                     # Minimal ABIs for all 7 contracts
│   │   ├── x402.ts                     # x402 protocol (buildPaymentRequest, buildPaymentProof)
│   │   ├── escrow.ts                   # getEscrowData() with fresh provider + retry logic
│   │   ├── chainlink.ts                # Oracle: Chainlink → CoinGecko → simulated fallback
│   │   ├── middleware.ts               # Rate limiting, API key auth, request logger
│   │   └── storage.ts                  # SQLite (oracle_results, task_records, payment_proofs, service_results)
│   ├── agentB/server.ts                # Oracle Provider #1 (port 3402)
│   ├── agentC/server.ts                # Oracle Provider #2 (port 3403)
│   ├── agentD/server.ts                # Translation #1 (port 3404)
│   ├── agentE/server.ts                # Summarization #1 (port 3405)
│   ├── agentF/server.ts                # Code Review #1 (port 3406)
│   ├── agentG/server.ts                # Translation #2 Budget (port 3407)
│   ├── agentH/server.ts                # Summarization #2 Analytical (port 3408)
│   ├── agentI/server.ts                # Code Review #2 Security (port 3409)
│   ├── marketplace/client.ts           # Marketplace orchestrator (10-step workflow)
│   └── data/agent.db                   # SQLite database
├── dashboard/
│   └── server.ts                       # API Gateway (port 3400)
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx                # Dashboard home
│       │   ├── services/page.tsx       # Marketplace + gateway log panel
│       │   ├── providers/page.tsx      # Agent browser
│       │   └── history/page.tsx        # Task history
│       ├── components/
│       │   ├── layout/                 # Header (wallet + USDC balance), Sidebar
│       │   ├── services/               # ServiceCard, TranslationForm, SummarizationForm,
│       │   │                           # CodeReviewForm, ServiceResult, GatewayLogPanel
│       │   ├── dashboard/              # StatsCards, HealthStatus, QuickActions
│       │   ├── providers/              # ProviderCard, CapabilityFilter
│       │   └── history/                # TaskTable
│       └── lib/
│           ├── api.ts                  # Axios client (baseURL from NEXT_PUBLIC_API_URL, 120s timeout)
│           ├── contracts.ts            # ERC20 ABI, TREASURY_ADDRESS
│           ├── hooks.ts                # SWR hooks: useStats, useHealth, useProviders, useHistory,
│           │                           # useConfig, useQuote, useTokenBalance
│           ├── wagmi.ts                # wagmi config (Hardhat + Arc Testnet)
│           └── utils.ts
├── scripts/
│   ├── deploy.ts                       # Deploy all 7 contracts + mint test USDC
│   └── run-demo.ts                     # E2E demo orchestrator
├── test/
│   └── full-flow.test.ts
├── ecosystem.config.js                 # PM2 config for all agents + gateway
├── hardhat.config.ts
└── .env
```

---

## API Gateway Endpoints

Base URL (production): `https://api.toanbm.xyz/arc`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | RPC URL + all contract addresses |
| `GET` | `/api/health` | System health (blockchain, contracts, all agents) |
| `GET` | `/api/services` | Available service types |
| `GET` | `/api/providers` | All registered agents with reputation |
| `GET` | `/api/providers/:capability` | Filter providers by capability tag |
| `GET` | `/api/quote/:service` | Live price from top-ranked provider (30s cache) |
| `POST` | `/api/services/translation` | Translation request |
| `POST` | `/api/services/summarization` | Summarization request |
| `POST` | `/api/services/code-review` | Code review request |
| `POST` | `/api/check` | Oracle workflow (Marketplace Client → B/C) |
| `GET` | `/api/history` | Recent task history |
| `GET` | `/api/marketplace/stats` | Aggregate marketplace stats |
| `GET` | `/api/pricing` | Treasury address |
| `GET` | `/api/supported-pairs` | Supported trading pairs for oracle |

---

## Quick Start

### Prerequisites

- Node.js >= 18
- npm
- MetaMask or compatible wallet

### Install

```bash
npm install
npm run frontend:install
npx hardhat compile
```

### Run Locally

```bash
# Terminal 1 — local blockchain
npm run node

# Terminal 2 — deploy contracts
npm run deploy:local

# Terminals 3–5 — service agents
npm run agent:d    # Translation  (port 3404)
npm run agent:e    # Summarization (port 3405)
npm run agent:f    # Code Review  (port 3406)

# Terminal 6 — API Gateway
npm run gateway    # port 3400

# Terminal 7 — frontend
npm run frontend:dev   # port 3000
```

Open http://localhost:3000, connect MetaMask (import any Hardhat account — it has test USDC), go to Services, and submit a request.

### Run on Arc Testnet

```bash
# 1. Configure environment
cp .env.example .env
# Fill in funded private keys and ARC_RPC_URL

# 2. Deploy contracts
npm run deploy:arc
# Copy printed addresses into .env

# 3. Start all agents + gateway via PM2
npm install -g pm2
pm2 start ecosystem.config.js

# 4. Check status
pm2 status
pm2 logs

# 5. Frontend (local dev against remote gateway)
# Set NEXT_PUBLIC_API_URL=https://your-domain.com/arc in frontend/.env.local
npm run frontend:dev
```

### PM2 Commands

```bash
pm2 start ecosystem.config.js    # Start all agents + gateway
pm2 stop ecosystem.config.js     # Stop all
pm2 restart ecosystem.config.js  # Restart all
pm2 restart gateway               # Restart a single process
pm2 logs                          # Stream all logs
pm2 logs gateway --lines 50       # Gateway logs only
pm2 monit                         # Process monitor
pm2 save && pm2 startup           # Persist across reboots
```

---

## User Payment Flow

| Step | Action |
|------|--------|
| 1 | Connect MetaMask via RainbowKit |
| 2 | Select a service — price shown on the submit button |
| 3 | Click "Pay X USDC & Submit" |
| 4 | Frontend calls `USDC.transfer(treasury, amount)` via wagmi |
| 5 | Frontend sends request to gateway with `paymentTxHash` |
| 6 | Gateway verifies the USDC Transfer event on-chain |
| 7 | Gateway runs the 10-step marketplace workflow |
| 8 | Result displayed, gateway log panel shows all steps |

Service prices:

| Service | Price |
|---------|-------|
| Translation | 2.0 USDC |
| Summarization | 1.5 USDC |
| Code Review | 3.0 USDC |

---

## Configuration

**Backend** (`.env`):

| Variable | Description |
|----------|-------------|
| `PRIVATE_KEY_AGENT_A` – `PRIVATE_KEY_AGENT_I` | Wallet keys for each agent |
| `PRIVATE_KEY_TREASURY` | Marketplace client wallet |
| `TREASURY_ADDRESS` | Receives user USDC payments |
| `ARC_RPC_URL` | Arc Testnet RPC (e.g. `https://5042002.rpc.thirdweb.com`) |
| `USDC_ADDRESS` | Arc USDC contract address |
| `IDENTITY_REGISTRY_ADDRESS` | IdentityRegistry contract |
| `REPUTATION_REGISTRY_ADDRESS` | ReputationRegistry contract |
| `VALIDATION_REGISTRY_ADDRESS` | ValidationRegistry contract |
| `PAYMENT_ESCROW_ADDRESS` | PaymentEscrow contract |
| `GATEWAY_PORT` | API Gateway port (default: `3400`) |
| `AGENT_B_PORT` / `AGENT_B_URL` | Agent B address (default: `3402`) |
| `AGENT_C_PORT` through `AGENT_I_PORT` | Agent ports `3403`–`3409` |

**Frontend** (`frontend/.env.local`):

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Gateway URL (`https://api.toanbm.xyz/arc` or `http://localhost:3400`) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect project ID |
| `NEXT_PUBLIC_TREASURY_ADDRESS` | Treasury address for USDC payments |

---

## npm Scripts

```bash
npm run compile          # Compile contracts
npm run test             # Run tests
npm run deploy:local     # Deploy to Hardhat localhost
npm run deploy:arc       # Deploy to Arc Testnet
npm run node             # Start Hardhat local node
npm run gateway          # Start API Gateway (port 3400)
npm run frontend:dev     # Start Next.js frontend (port 3000)
npm run frontend:install # Install frontend dependencies
npm run agent:b          # Agent B — Oracle Provider #1 (port 3402)
npm run agent:c          # Agent C — Oracle Provider #2 (port 3403)
npm run agent:d          # Agent D — Translation #1 (port 3404)
npm run agent:e          # Agent E — Summarization #1 (port 3405)
npm run agent:f          # Agent F — Code Review #1 (port 3406)
npm run agent:g          # Agent G — Translation #2 (port 3407)
npm run agent:h          # Agent H — Summarization #2 (port 3408)
npm run agent:i          # Agent I — Code Review #2 (port 3409)
npm run marketplace      # Marketplace orchestrator (on-demand)
npm run demo             # E2E demo script
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Solidity 0.8.24, OpenZeppelin 5.x, Hardhat + TypeChain |
| Agents | TypeScript, Express.js, ethers.js v6 |
| Storage | SQLite (better-sqlite3) |
| Frontend | Next.js 14 (App Router), wagmi v2, viem, RainbowKit, Tailwind CSS, SWR |
| Process Manager | PM2 (ecosystem.config.js) |
| Reverse Proxy | nginx (HTTPS, `/arc/` path prefix) |
| Oracle Data | Chainlink on-chain → CoinGecko API → simulated fallback |
| Network | Arc Testnet (Chain ID: 5042002) or Hardhat local (Chain ID: 31337) |
| Testing | Mocha + Chai via Hardhat Toolbox |
