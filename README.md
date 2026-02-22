# AI Agent Economy PoC — ERC-8004 + x402 + Chainlink

A proof-of-concept demonstrating an autonomous AI agent economy where:

- **Agent A** (Client Trading Bot) hires **Agent B** (Oracle Provider)
- Agent B fetches real-time price data from Chainlink/CoinGecko and runs trend analysis
- Agents discover each other on-chain via **ERC-8004 Identity Registry**
- Payment is handled via **x402 HTTP 402** micropayments with USDC escrow
- All work is verified on-chain with cryptographic proof-of-work hashes
- Both agents build on-chain **reputation** through mutual feedback
- A **Marketplace Frontend** lets users pay USDC to access AI services (translation, summarization, code review)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ARC TESTNET (Chain ID: 5042002)               │
│                                                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │  Identity     │ │  Reputation  │ │  Validation  │            │
│  │  Registry     │ │  Registry    │ │  Registry    │            │
│  │  (ERC-8004)   │ │  (ERC-8004)  │ │  (ERC-8004)  │            │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘            │
│         │                │                │                      │
│  ┌──────┴────────────────┴────────────────┴──────┐              │
│  │              PaymentEscrow (USDC)              │              │
│  └───────────────────┬───────────────────────────┘              │
└──────────────────────┼───────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   ┌────▼────┐   x402 HTTP 402  ┌────▼────┐
   │ AGENT A  │◄────────────────►│ AGENT B  │
   │ Trading  │  micropayments   │ Oracle   │
   │ Bot      │                  │ Provider │
   └─────────┘                   └────┬────┘
                                      │
                                 ┌────▼────┐
                                 │Chainlink │
                                 │/ CoinGecko│
                                 └──────────┘

   ┌───────────────────────────────────────────────────────┐
   │              Marketplace Services                      │
   │                                                        │
   │  User (MetaMask)                                       │
   │    │                                                   │
   │    ├─ USDC Transfer ──► Treasury                       │
   │    │                                                   │
   │    └─ API Request ──► Gateway ──► Agent D (Translation)│
   │                              ├──► Agent E (Summarize)  │
   │                              └──► Agent F (Code Review)│
   └───────────────────────────────────────────────────────┘
```

## Marketplace — User Payment Flow

Users pay per request via MockUSDC transfers to a treasury address. The frontend prompts wallet signing, then submits the payment tx hash to the backend for on-chain verification.

| Service | Price | Raw Amount (6 decimals) |
|---------|-------|-------------------------|
| Translation | 2.0 USDC | `2000000` |
| Summarization | 1.5 USDC | `1500000` |
| Code Review | 3.0 USDC | `3000000` |

**Flow:**
1. User connects wallet (MetaMask/RainbowKit)
2. User fills service form, clicks "Pay X USDC & Submit"
3. Frontend calls `MockUSDC.transfer(treasury, amount)` via wagmi
4. Frontend sends API request with `paymentTxHash`
5. Gateway verifies the USDC Transfer event on-chain
6. Service agent processes the request and returns result

## Workflow (Oracle — Agent A ↔ Agent B)

| Step | Action | On-Chain |
|------|--------|----------|
| 1. Discovery | Agent A queries IdentityRegistry for `"oracle"` capability | Read |
| 2. Reputation | Agent A checks Agent B's score in ReputationRegistry | Read |
| 3. Task Creation | Agent A registers task in ValidationRegistry | Write |
| 4. Escrow Deposit | Agent A locks USDC in PaymentEscrow (x402 pre-payment) | Write |
| 5. x402 Flow | Agent A sends HTTP request → 402 → pays → re-requests with proof | HTTP + Read |
| 6. Execution | Agent B fetches oracle data, submits proof hash to ValidationRegistry | Write |
| 7. Verification | Agent A verifies result hash on-chain, marks task Verified | Write |
| 8. Payment | Agent A releases USDC from escrow to Agent B | Write |
| 9. Reputation | Both agents submit mutual feedback to ReputationRegistry | Write |

## Project Structure

```
arc-8004/
├── contracts/
│   ├── IdentityRegistry.sol    # ERC-8004 agent identity & discovery
│   ├── ReputationRegistry.sol  # On-chain reputation scoring
│   ├── ValidationRegistry.sol  # Proof-of-work task records
│   ├── PaymentEscrow.sol       # x402 USDC escrow settlement
│   ├── ArbitrationRegistry.sol # Dispute resolution with arbitrators
│   ├── NegotiationManager.sol  # RFQ/bidding for competitive pricing
│   └── MockUSDC.sol            # Test ERC-20 token (6 decimals)
├── agents/
│   ├── shared/
│   │   ├── config.ts           # Shared config (RPC, keys, addresses, treasury)
│   │   ├── abis.ts             # Minimal contract ABIs
│   │   ├── chainlink.ts        # Oracle data fetcher (CoinGecko + Chainlink)
│   │   ├── x402.ts             # x402 protocol helpers
│   │   ├── middleware.ts       # Express middleware (rate limit, auth, logging)
│   │   └── storage.ts          # SQLite persistence (better-sqlite3)
│   ├── agentA/client.ts        # Agent A: Client Trading Bot
│   ├── agentB/server.ts        # Agent B: Oracle Provider #1 (port 3402)
│   ├── agentC/server.ts        # Agent C: Oracle Provider #2 (port 3403)
│   ├── agentD/server.ts        # Agent D: Translation Service (port 3404)
│   ├── agentE/server.ts        # Agent E: Summarization Service (port 3405)
│   ├── agentF/server.ts        # Agent F: Code Review Service (port 3406)
│   └── marketplace/client.ts   # Marketplace orchestrator
├── dashboard/
│   ├── server.ts               # API Gateway (port 3400) — routes, pricing, tx verification
│   └── index.html              # Legacy monitoring dashboard
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── layout.tsx      # Root layout with wallet provider
│       │   ├── page.tsx        # Dashboard home
│       │   ├── providers.tsx   # wagmi + RainbowKit providers
│       │   ├── services/page.tsx   # Marketplace services page
│       │   ├── providers/page.tsx  # Agent providers browser
│       │   └── history/page.tsx    # Task history
│       ├── components/
│       │   ├── layout/
│       │   │   ├── Header.tsx      # App header with ConnectButton + USDC balance
│       │   │   └── Sidebar.tsx     # Navigation sidebar
│       │   ├── services/
│       │   │   ├── ServiceCard.tsx      # Service card with price badge
│       │   │   ├── TranslationForm.tsx  # Translation form with USDC payment
│       │   │   ├── SummarizationForm.tsx # Summarization form with USDC payment
│       │   │   ├── CodeReviewForm.tsx   # Code review form with USDC payment
│       │   │   └── ServiceResult.tsx    # Result display component
│       │   ├── dashboard/
│       │   │   ├── StatsCards.tsx       # Aggregate stats
│       │   │   ├── HealthStatus.tsx     # System health indicators
│       │   │   └── QuickActions.tsx     # Quick action buttons
│       │   ├── providers/
│       │   │   ├── ProviderCard.tsx     # Provider info card
│       │   │   └── CapabilityFilter.tsx # Filter by capability
│       │   └── history/
│       │       └── TaskTable.tsx        # Task history table
│       └── lib/
│           ├── api.ts          # Axios API client (with paymentTxHash support)
│           ├── contracts.ts    # ERC20 ABI, SERVICE_PRICES, TREASURY_ADDRESS
│           ├── hooks.ts        # SWR hooks (usePricing, useConfig, useTokenBalance, etc.)
│           ├── wagmi.ts        # wagmi config (Hardhat + Arc Testnet chains)
│           └── utils.ts        # Formatting helpers
├── scripts/
│   ├── deploy.ts               # Contract deployment script
│   └── run-demo.ts             # Full E2E demo orchestrator
├── test/
│   └── full-flow.test.ts       # Contract + integration tests
├── subgraph/                   # Scaffolded (handlers not implemented)
│   ├── subgraph.yaml
│   ├── schema.graphql
│   └── src/                    # Stub mapping files
├── hardhat.config.ts
├── package.json
└── .env.example
```

## Quick Start

### Prerequisites

- Node.js >= 18
- npm
- MetaMask or compatible wallet browser extension

### Setup

```bash
# Install dependencies
npm install

# Install frontend dependencies
npm run frontend:install

# Compile contracts
npx hardhat compile
```

### Run Tests

```bash
npx hardhat test
```

### Run Locally (Full Stack)

```bash
# Terminal 1: Start local blockchain
npm run node

# Terminal 2: Deploy contracts
npm run deploy:local

# Terminal 3: Start Agent D (Translation)
npm run agent:d

# Terminal 4: Start Agent E (Summarization)
npm run agent:e

# Terminal 5: Start Agent F (Code Review)
npm run agent:f

# Terminal 6: Start API Gateway
npm run gateway

# Terminal 7: Start frontend
npm run frontend:dev
```

Then:
1. Open http://localhost:3000
2. Import a Hardhat account into MetaMask (has MockUSDC from deployment)
3. Connect wallet — USDC balance shows in header
4. Go to Services → pick a service → see price on button
5. Submit → wallet prompts USDC transfer → approve → service executes → result shows

### Deploy to Arc Testnet

```bash
# 1. Copy and fill in your .env
cp .env.example .env
# Edit .env with funded wallet keys for Arc Testnet

# 2. Deploy contracts
npm run deploy:arc

# 3. Copy printed addresses into .env

# 4. Start service agents
npm run agent:d   # Translation (port 3404)
npm run agent:e   # Summarization (port 3405)
npm run agent:f   # Code Review (port 3406)

# 5. Start gateway + frontend
npm run gateway
npm run frontend:dev
```

## Smart Contracts

### IdentityRegistry (ERC-8004)

Agents register with name, endpoint, and capability tags. Other agents discover peers by querying capabilities.

**Key functions:**
- `registerAgent(name, endpoint, capabilities)` — Register a new agent
- `findByCapability(tag)` — Discover agents by capability
- `getAgent(address)` — Look up a specific agent

### ReputationRegistry (ERC-8004)

Tracks cumulative reputation scores (1-5 scale) for each agent across tasks.

**Key functions:**
- `submitFeedback(toAgent, taskId, score, comment)` — Rate an agent
- `getAverageScore(agent)` — Get average score (scaled x100)
- `getSuccessRate(agent)` — Get percentage of tasks rated >= 3

### ValidationRegistry (ERC-8004)

Stores task records with cryptographic proof-of-work hashes for verification.

**Key functions:**
- `createTask(taskId, provider, description)` — Create a new task
- `submitResult(taskId, resultHash, resultUri)` — Submit proof-of-work
- `verifyResult(taskId)` / `disputeResult(taskId)` — Accept or reject
- `verifyHash(taskId, dataHash)` — Check if a hash matches on-chain

### PaymentEscrow (x402)

USDC escrow for "no work, no pay" settlement. Funds are locked until the requester verifies and releases.

**Key functions:**
- `deposit(taskId, payee, amount)` — Lock USDC for a task
- `release(taskId)` — Pay the provider
- `refund(taskId)` — Refund on dispute

### ArbitrationRegistry

Dispute resolution with arbitrator panel. Payer files dispute, payee submits evidence, arbitrator rules.

**Key functions:**
- `fileDispute(taskId, payee, reason)` — Initiate dispute
- `submitEvidence(taskId, evidence)` — Counter-evidence
- `resolve(taskId, ruling, rulingReason)` — Arbitrator decides

### NegotiationManager

RFQ/bidding system for competitive pricing between service providers.

**Key functions:**
- `createRfq(rfqId, capability, description, maxBudget, biddingTime)` — Post RFQ
- `submitBid(rfqId, bidId, price, estimatedTime, terms)` — Provider bids
- `awardBid(rfqId, bidId)` — Requester picks winner

## API Gateway Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | RPC URL + contract addresses |
| `GET` | `/api/pricing` | Treasury address + per-service prices |
| `GET` | `/api/health` | System health check (blockchain, contracts, agents) |
| `GET` | `/api/services` | List available service types |
| `GET` | `/api/providers` | All registered agents with reputation |
| `GET` | `/api/providers/:capability` | Filter providers by capability |
| `POST` | `/api/services/translation` | Submit translation (accepts `paymentTxHash`) |
| `POST` | `/api/services/summarization` | Submit summarization (accepts `paymentTxHash`) |
| `POST` | `/api/services/code-review` | Submit code review (accepts `paymentTxHash`) |
| `POST` | `/api/check` | Oracle workflow (Agent A → Agent B) |
| `GET` | `/api/history` | Recent task history |
| `GET` | `/api/marketplace/stats` | Aggregate marketplace stats |

## Configuration

All configuration is via environment variables (`.env`):

| Variable | Description | Default |
|----------|-------------|---------|
| `PRIVATE_KEY_AGENT_A` | Agent A wallet private key | Hardhat #0 |
| `PRIVATE_KEY_AGENT_B` | Agent B wallet private key | Hardhat #1 |
| `PRIVATE_KEY_AGENT_C` | Agent C wallet private key | Hardhat #2 |
| `PRIVATE_KEY_AGENT_D` | Agent D (Translation) private key | Hardhat #3 |
| `PRIVATE_KEY_AGENT_E` | Agent E (Summarization) private key | Hardhat #4 |
| `PRIVATE_KEY_AGENT_F` | Agent F (Code Review) private key | Hardhat #5 |
| `PRIVATE_KEY_MARKETPLACE` | Marketplace client key | Hardhat #6 |
| `TREASURY_ADDRESS` | Treasury for user payments | Hardhat #7 |
| `ARC_RPC_URL` | RPC endpoint | `http://127.0.0.1:8545` |
| `USDC_ADDRESS` | MockUSDC contract address | — |
| `IDENTITY_REGISTRY_ADDRESS` | IdentityRegistry address | — |
| `REPUTATION_REGISTRY_ADDRESS` | ReputationRegistry address | — |
| `VALIDATION_REGISTRY_ADDRESS` | ValidationRegistry address | — |
| `PAYMENT_ESCROW_ADDRESS` | PaymentEscrow address | — |
| `ARBITRATION_REGISTRY_ADDRESS` | ArbitrationRegistry address | — |
| `NEGOTIATION_MANAGER_ADDRESS` | NegotiationManager address | — |
| `GATEWAY_PORT` | API Gateway port | `3400` |
| `AGENT_B_PORT` | Agent B HTTP server port | `3402` |
| `AGENT_D_PORT` | Agent D (Translation) port | `3404` |
| `AGENT_E_PORT` | Agent E (Summarization) port | `3405` |
| `AGENT_F_PORT` | Agent F (Code Review) port | `3406` |

## npm Scripts

```bash
npm run compile        # Compile contracts
npm run test           # Run tests
npm run deploy:local   # Deploy to localhost
npm run deploy:arc     # Deploy to Arc Testnet
npm run node           # Start Hardhat local node
npm run gateway        # Start API Gateway (port 3400)
npm run frontend:dev   # Start Next.js frontend (port 3000)
npm run frontend:install # Install frontend dependencies
npm run agent:a        # Agent A — Client Trading Bot
npm run agent:b        # Agent B — Oracle Provider #1 (port 3402)
npm run agent:c        # Agent C — Oracle Provider #2 (port 3403)
npm run agent:d        # Agent D — Translation Service (port 3404)
npm run agent:e        # Agent E — Summarization Service (port 3405)
npm run agent:f        # Agent F — Code Review Service (port 3406)
npm run marketplace    # Marketplace orchestrator
npm run demo           # Run E2E demo (ts-node)
npm run demo:local     # Run E2E demo (hardhat localhost)
```

## Tech Stack

- **Smart Contracts**: Solidity 0.8.24, OpenZeppelin 5.x
- **Framework**: Hardhat with TypeChain
- **Agents**: TypeScript, Express.js, ethers.js v6
- **Frontend**: Next.js 14 (App Router), wagmi v2, viem, RainbowKit, Tailwind CSS, SWR
- **Oracle**: CoinGecko API (Chainlink Aggregator on supported networks)
- **Storage**: SQLite (better-sqlite3)
- **Testing**: Mocha + Chai via Hardhat Toolbox
- **Network**: Arc Testnet (Chain ID: 5042002) or local Hardhat (Chain ID: 31337)
