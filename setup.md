# Setup Guide: From PoC to Full AI Agent Marketplace

---

## 1. Current State (Complete Inventory)

### 1.1 Smart Contracts — 7 Contracts (All Deployed on Arc Testnet, Chain ID: 5042002)

| Contract | File | Purpose | Lines |
|----------|------|---------|-------|
| **IdentityRegistry** | `contracts/IdentityRegistry.sol` | ERC-8004 agent registration & discovery | 166 |
| **ReputationRegistry** | `contracts/ReputationRegistry.sol` | On-chain reputation scoring (1-5 scale) | 120 |
| **ValidationRegistry** | `contracts/ValidationRegistry.sol` | Task records + cryptographic proof-of-work | 142 |
| **PaymentEscrow** | `contracts/PaymentEscrow.sol` | USDC escrow with timeout/expiry (x402) | 172 |
| **ArbitrationRegistry** | `contracts/ArbitrationRegistry.sol` | Dispute resolution with arbitrators | 168 |
| **NegotiationManager** | `contracts/NegotiationManager.sol` | RFQ/bidding system for competitive pricing | 214 |
| **TestToken** | `contracts/TestToken.sol` | Minimal ERC-20 for local Hardhat testing only | 24 |

#### IdentityRegistry — What's Built
- `registerAgent(name, endpoint, capabilities)` — register with capability tags
- `findByCapability(tag)` — discover agents by tag (e.g., "oracle")
- `getAgent(address)` — lookup agent details
- `updateEndpoint(endpoint)` — change API endpoint
- `deactivate()` — soft delete
- `agentCount()` / `agentList(i)` — enumerate all agents
- Auto-generates DID: `did:erc8004:<address>`
- Events: `AgentRegistered`, `AgentUpdated`, `AgentDeactivated`

#### ReputationRegistry — What's Built
- `submitFeedback(toAgent, taskId, score, comment)` — rate 1-5, prevents duplicates per (sender, taskId)
- `getAverageScore(agent)` — returns score x100 (e.g., 450 = 4.50)
- `getSuccessRate(agent)` — percentage of tasks rated >= 3
- `getReputation(agent)` — full struct (totalScore, taskCount, successCount, lastUpdated)
- `feedbackCount()` — total feedback entries
- `feedbackLog[]` — full audit trail of all feedback
- Events: `FeedbackAdded`

#### ValidationRegistry — What's Built
- `createTask(taskId, provider, description)` — create task (Pending)
- `submitResult(taskId, resultHash, resultUri)` — provider submits proof (Submitted)
- `verifyResult(taskId)` — requester accepts (Verified)
- `disputeResult(taskId)` — requester rejects (Disputed)
- `verifyHash(taskId, dataHash)` — check hash match on-chain
- `taskCount()` / `taskIds(i)` — enumerate tasks
- States: Pending -> Submitted -> Verified | Disputed
- Events: `TaskCreated`, `TaskSubmitted`, `TaskVerified`, `TaskDisputed`

#### PaymentEscrow — What's Built
- `deposit(taskId, payee, amount)` — lock USDC (1-hour default timeout)
- `depositWithTimeout(taskId, payee, amount, timeout)` — custom timeout (min 5 min)
- `release(taskId)` — pay provider (payer only)
- `refund(taskId)` — refund payer (payer only)
- `claimExpired(taskId)` — auto-refund after deadline (anyone can call)
- `isExpired(taskId)` / `timeRemaining(taskId)` — check timeout
- `getEscrow(taskId)` — full escrow record
- States: None -> Funded -> Released | Refunded | Expired
- Uses OpenZeppelin SafeERC20
- Events: `EscrowCreated`, `EscrowReleased`, `EscrowRefunded`, `EscrowExpired`

#### ArbitrationRegistry — What's Built
- `fileDispute(taskId, payee, reason)` — payer initiates dispute
- `submitEvidence(taskId, evidence)` — payee submits counter-evidence
- `resolve(taskId, ruling, rulingReason)` — arbitrator decides (FavorPayer or FavorPayee)
- `addArbitrator(address)` / `removeArbitrator(address)` — owner manages arbitrators
- `getDispute(taskId)` / `disputeCount()` — read disputes
- Rulings: Pending -> FavorPayer | FavorPayee
- Integrated with PaymentEscrow for fund settlement
- Events: `DisputeFiled`, `EvidenceSubmitted`, `DisputeResolved`

#### NegotiationManager — What's Built
- `createRfq(rfqId, capability, description, maxBudget, biddingTime)` — requester posts RFQ
- `submitBid(rfqId, bidId, price, estimatedTime, terms)` — providers compete
- `awardBid(rfqId, bidId)` — requester picks winner (losers auto-marked Lost)
- `cancelRfq(rfqId)` / `withdrawBid(bidId)` — lifecycle management
- `getRfq(rfqId)` / `getBid(bidId)` / `getBidsForRfq(rfqId)` / `rfqCount()` — reads
- RFQ States: Open -> Awarded | Cancelled
- Bid States: Active -> Won | Lost | Withdrawn
- Events: `RfqCreated`, `BidSubmitted`, `BidAwarded`, `RfqCancelled`, `BidWithdrawn`

### 1.2 Agent Backends — 6 Agents + Marketplace Client + 6 Shared Modules

| File | Role | Port | Pricing | Lines |
|------|------|------|---------|-------|
| `agents/agentA/client.ts` | Client Trading Bot (consumer) | N/A (CLI) | Pays others | 296 |
| `agents/agentB/server.ts` | Oracle Provider #1 (Express) | 3402 | 5 USDC/task | 269 |
| `agents/agentC/server.ts` | Oracle Provider #2 (Express) | 3403 | 3 USDC/task | 296 |
| `agents/agentD/server.ts` | Translation Service (Express) | 3404 | 2 USDC/task | — |
| `agents/agentE/server.ts` | Summarization Service (Express) | 3405 | 1.5 USDC/task | — |
| `agents/agentF/server.ts` | Code Review Service (Express) | 3406 | 3 USDC/task | — |
| `agents/marketplace/client.ts` | Marketplace orchestrator | N/A | — | — |

#### Agent A — Client Trading Bot
- 9-step autonomous workflow: discover -> check reputation -> create task -> escrow deposit -> x402 request (402 -> pay -> retry) -> verify hash -> release payment -> rate provider
- Ranks multiple providers by reputation score (highest first), then by task count
- Supports any trading pair (ETH/USD, BTC/USD, etc.)
- Exports: `runWorkflow(pair): Promise<WorkflowResult>`
- Capabilities: `["trading", "client"]`

#### Agent B — Oracle Provider #1
- Express.js server with x402 micropayment flow
- Registers self in IdentityRegistry on startup as "OracleBot-B"
- Endpoints: `GET /health`, `GET /capabilities`, `POST /oracle/request`, `POST /feedback`
- Phase 1: returns 402 with payment details, pre-fetches data
- Phase 2: verifies escrow on-chain, delivers data + submits proof hash to ValidationRegistry
- Data source: Chainlink on-chain -> CoinGecko API -> simulated fallback
- Supported pairs: ETH/USD, BTC/USD
- Capabilities: `["oracle", "analysis", "chainlink"]`

#### Agent C — Oracle Provider #2 (Competitive)
- Same architecture as Agent B but competes on price and features
- Pricing: 3 USDC (vs Agent B's 5 USDC)
- Additional endpoint: `POST /quote` (returns price quote for negotiation)
- Multi-source data aggregation
- Supported pairs: ETH/USD, BTC/USD, SOL/USD (more than Agent B)
- Capabilities: `["oracle", "analysis", "multi-source"]`
- Demonstrates marketplace competition: Agent A can discover both B and C, compare reputation + price, and choose the best provider

#### Agent D — Translation Service
- Express.js server providing text translation
- Registered with capability `"translation"`
- Port 3404

#### Agent E — Summarization Service
- Express.js server providing text summarization
- Registered with capability `"summarization"`
- Port 3405

#### Agent F — Code Review Service
- Express.js server providing automated code review
- Registered with capability `"code-review"`
- Port 3406

#### Marketplace Client
- `agents/marketplace/client.ts` — Orchestrates service discovery, task creation, escrow, and result verification for marketplace services
- Exports: `runServiceRequest(serviceType, input)`, `SERVICE_REGISTRY`

#### Shared Modules

| File | Purpose | What's Built |
|------|---------|-------------|
| `agents/shared/config.ts` | Centralized config | RPC URL, 7 private keys (agents A-F + marketplace), treasury address, 7 contract addresses, ports, payment defaults |
| `agents/shared/abis.ts` | Contract ABIs | Minimal ABIs for all 7 contracts (functions + events) |
| `agents/shared/x402.ts` | x402 protocol | `buildPaymentRequest()`, `buildPaymentProof()`, `parsePaymentRequest()`, `parsePaymentProof()` — full 402 flow |
| `agents/shared/chainlink.ts` | Oracle data fetcher | Chainlink on-chain -> CoinGecko API -> simulated fallback. Includes `analyzeTrend()` (bullish/bearish/neutral with confidence) |
| `agents/shared/middleware.ts` | Express middleware | `standardLimiter` (30 req/min), `oracleLimiter` (10 req/min), `apiKeyAuth` (X-API-Key header), `requestLogger` |
| `agents/shared/storage.ts` | Persistent storage | SQLite (better-sqlite3) with tables for oracle_results, task_records, payment_proofs, service_results. Includes `getStats()`, `getRecentTasks()`, `getServiceResult()` |

#### Data Storage
- **Database**: `agents/data/agent.db` (SQLite)
- **Tables**: oracle_results (task_id, pair, result_json, result_hash), task_records (task_id, requester, status, pair, payment_tx), payment_proofs (task_id, tx_hash, payer, amount, verified)
- **Indexes**: idx_oracle_pair, idx_task_status

### 1.3 Gateway + Dashboard

#### API Gateway (`dashboard/server.ts`)
- Express.js server on port 3400
- CORS enabled for all `/api/*` routes
- Oracle endpoints: `POST /api/check` (rate-limited, cached)
- Marketplace service endpoints: `POST /api/services/{translation,summarization,code-review}` with optional on-chain payment verification (`paymentTxHash`)
- Pricing endpoint: `GET /api/pricing` — returns treasury address + per-service prices
- Config endpoint: `GET /api/config` — returns RPC URL + all contract addresses
- Discovery endpoints: `GET /api/services`, `GET /api/providers`, `GET /api/providers/:capability`
- History + stats: `GET /api/history`, `GET /api/marketplace/stats`
- Health check: `GET /api/health` — checks blockchain, contracts, all agents
- Payment verification: validates USDC Transfer events on-chain for user payments
- Concurrency gates: prevents overlapping requests per service type

#### Legacy Dashboard (`dashboard/index.html`)
- Single-page monitoring app (500+ lines)
- Dark theme, ethers.js v6, vanilla JS
- 4 panels: Registered Agents, Reputation Scores, Recent Tasks, Escrow Balances
- Read-only: no wallet signing, no transactions

### 1.4 Frontend — Next.js Marketplace UI

#### Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Wallet**: wagmi v2 + viem + RainbowKit
- **Styling**: Tailwind CSS
- **Data Fetching**: SWR (stale-while-revalidate)
- **Forms**: react-hook-form + zod validation

#### Pages
- `/` — Dashboard home with stats cards, health status, quick actions
- `/services` — Marketplace services (Translation, Summarization, Code Review) with USDC payment flow
- `/providers` — Browse registered agents with reputation, filterable by capability
- `/history` — Task history table

#### Key Components
- `Header.tsx` — App header with RainbowKit ConnectButton + USDC balance display
- `Sidebar.tsx` — Navigation sidebar
- `ServiceCard.tsx` — Service card with price badge (e.g., "2.0 USDC")
- `TranslationForm.tsx` — Translation form with wallet payment flow (USDC transfer → tx verification → service execution)
- `SummarizationForm.tsx` — Same payment pattern for summarization
- `CodeReviewForm.tsx` — Same payment pattern for code review
- `ServiceResult.tsx` — Result display after service execution
- `ProviderCard.tsx` — Agent info card with reputation
- `CapabilityFilter.tsx` — Filter providers by capability tag

#### Frontend Libraries (`frontend/src/lib/`)
- `api.ts` — Axios client for all gateway endpoints; submit functions accept optional `paymentTxHash`
- `contracts.ts` — ERC20 ABI subset (`transfer`, `balanceOf`), `SERVICE_PRICES` map, `TREASURY_ADDRESS` constant
- `hooks.ts` — SWR hooks: `useStats`, `useHealth`, `useProviders`, `useHistory`, `useConfig`, `usePricing`, `useTokenBalance` (wagmi `useReadContract`)
- `wagmi.ts` — wagmi config with Hardhat (31337) and Arc Testnet (5042002) chains
- `utils.ts` — Formatting helpers

#### User Payment Flow (per service request)
1. User connects MetaMask via RainbowKit
2. USDC balance displayed in header (fetched via `useTokenBalance`)
3. User selects a service → form shows price on submit button ("Pay 2.0 USDC & Submit")
4. On submit: frontend calls `USDC.transfer(treasury, amount)` via wagmi `writeContractAsync`
5. Waits for tx confirmation
6. Sends API request to gateway with `paymentTxHash` in body
7. Gateway verifies USDC Transfer event on-chain (checks recipient = treasury, amount >= required)
8. If verification passes (or no hash provided for backward compat), service executes
9. Result displayed in `ServiceResult` component

### 1.4 Subgraph (Scaffolded, Handlers Not Implemented)
- `subgraph/subgraph.yaml` — Config for all 6 data sources (contract addresses set to 0x0000...)
- `subgraph/schema.graphql` — 12 GraphQL entities (Agent, Reputation, Feedback, Task, Escrow, Rfq, Bid, Dispute + enums)
- `subgraph/src/` — 6 mapping files (identity.ts, reputation.ts, validation.ts, escrow.ts, negotiation.ts, arbitration.ts) — **stubs only, event handlers not implemented**

### 1.5 Tests
- `test/full-flow.test.ts` — 9+ test cases covering IdentityRegistry, ValidationRegistry, PaymentEscrow, reputation, negotiation
- Framework: Mocha + Chai via Hardhat Toolbox
- Fixture with 5 signers (deployer, agentA, agentB, agentC, arbitrator)

### 1.6 Scripts
- `scripts/deploy.ts` — Deploys all 7 contracts with 5s delays (ThirdWeb rate-limit fix) + mints 1000 USDC to all signers
- `scripts/run-demo.ts` — Full E2E orchestrator: deploys contracts, starts Agent B + C, runs negotiation demo (RFQ -> bids -> award), runs Agent A workflow, demonstrates escrow timeout

### 1.7 Known Issues Fixed
- ThirdWeb RPC rate-limits at ~3 req/sec — deploy.ts now has 5s delays between contracts
- USDC was not minted during deploy — deploy.ts now auto-mints 1000 USDC to all signers (local only)
- Dashboard requires manual copy-paste of RPC URL and contract addresses

---

## 2. Gap Analysis (What Exists vs What's Needed)

| Feature | Current Status | What's Needed |
|---------|---------------|---------------|
| Agent registration | CLI only (code calls `registerAgent`) | Web UI with MetaMask wallet connection |
| Agent discovery | `findByCapability()` works; providers page in frontend | Profile pages with reputation history |
| Pricing | Fixed per-service pricing (2/1.5/3 USDC); NegotiationManager on-chain | Expose RFQ/bidding in UI |
| User payments | **DONE** — USDC transfer to treasury, on-chain verification, pay-per-request flow | — |
| USDC balance | **DONE** — Shown in header when wallet connected | — |
| Marketplace services | **DONE** — Translation, Summarization, Code Review with payment flow | Additional service types |
| Wallet connection | **DONE** — RainbowKit + wagmi in frontend with MetaMask signing | — |
| Competitive agents | Agent B (5 USDC) vs Agent C (3 USDC) both work | UI to compare agents side-by-side |
| Dispute resolution | ArbitrationRegistry fully built (file, evidence, resolve) | Dispute UI for payers, payees, and arbitrators |
| Agent profiles | On-chain data exists but no profile pages | Profile pages with reputation history, task history |
| Task management | History page shows recent tasks; Agent A runs full workflow via CLI | Consumer/provider dashboards for managing tasks |
| Payment management | Escrow works (deposit, release, refund, timeout); user payments via treasury | UI for escrow status, earnings |
| Agent SDK | Agent B/C/D/E/F code works but not packaged | npm package + CLI for third-party agent deployment |
| Subgraph indexing | Schema + config scaffolded, handlers empty | Implement AssemblyScript event handlers |
| Rate limiting | `standardLimiter` (30/min) + `oracleLimiter` (10/min) + `serviceLimiter` (10/min) built | Contract-level spam prevention (registration fee) |
| API key auth | `apiKeyAuth` middleware built (disabled by default) | Enable in production, manage keys in UI |
| Agent health checks | `/health` endpoint exists on all agents; health page in frontend | Automated monitoring + "Online" badge |
| Real USDC | Arc testnet USDC (0x3600...0000) | Bridge or deploy with real USDC on mainnet |
| HTTPS | Not enforced | Require HTTPS for agent endpoints in production |
| EIP-712 signatures | Not implemented | Agent-to-agent request authentication |
| IdentityRegistry fields | name, endpoint, capabilities only | Add description, pricePerTask, apiSpecUrl |
| Pagination | `agentList(i)` loop (expensive at scale) | `getAgentsByPage(offset, limit)` helper |
| Reentrancy guards | PaymentEscrow uses SafeERC20 but no ReentrancyGuard | Add OpenZeppelin ReentrancyGuard |

---

## 3. Upgrade Phases

### Phase 1: Smart Contract Updates + Redeployment

**Goal:** Add missing fields and helpers needed by the frontend.

#### 1.1 IdentityRegistry — Add Pricing & Description

Current `AgentIdentity` struct:
```solidity
struct AgentIdentity {
    address wallet;
    string name;
    string did;
    string endpoint;
    string[] capabilities;
    uint256 registeredAt;
    bool active;
}
```

Add new fields:
```solidity
struct AgentIdentity {
    address wallet;
    string name;
    string did;
    string endpoint;
    string[] capabilities;
    uint256 registeredAt;
    bool active;
    // NEW:
    uint256 pricePerTask;    // USDC (6 decimals), 0 = use NegotiationManager
    string description;       // human-readable service description
    string apiSpecUrl;        // link to OpenAPI spec or docs
}
```

Update `registerAgent` signature:
```solidity
function registerAgent(
    string calldata _name,
    string calldata _endpoint,
    string[] calldata _capabilities,
    uint256 _pricePerTask,        // NEW
    string calldata _description,  // NEW
    string calldata _apiSpecUrl    // NEW
) external
```

Add new functions:
```solidity
function updateProfile(string calldata _description, string calldata _apiSpecUrl, uint256 _pricePerTask) external onlyRegistered
function findByCapabilityWithPrice(string calldata _capability, uint256 _maxPrice) external view returns (AgentIdentity[] memory)
function getAgentsByPage(uint256 _offset, uint256 _limit) external view returns (AgentIdentity[] memory)
```

#### 1.2 PaymentEscrow — Add ReentrancyGuard

```solidity
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PaymentEscrow is ReentrancyGuard {
    function deposit(...) external nonReentrant { ... }
    function release(...) external nonReentrant { ... }
    function refund(...) external nonReentrant { ... }
    function claimExpired(...) external nonReentrant { ... }
}
```

#### 1.3 Update Agent ABIs and Code

After contract changes:
- Update `agents/shared/abis.ts` with new function signatures
- Update `agents/agentB/server.ts` and `agents/agentC/server.ts` registration calls to include new fields
- Update `agents/agentA/client.ts` to use new `findByCapabilityWithPrice()` for better discovery
- Update `dashboard/index.html` ABIs
- Recompile: `npm run compile`
- Run tests: `npm run test`
- Redeploy: `npm run deploy:arc`

---

### Phase 2: Frontend — Registration Portal + Wallet Connection

**Goal:** Any developer can connect their wallet and register an AI agent on-chain.

#### 2.1 Tech Stack

```
frontend/
  framework:    Next.js 14+ (App Router)
  wallet:       wagmi v2 + viem + RainbowKit
  styling:      Tailwind CSS
  state:        TanStack Query (contract read caching)
  charts:       Recharts
  deployment:   Vercel
```

#### 2.2 Scaffold

```
frontend/
├── app/
│   ├── layout.tsx              # Root layout with wallet provider
│   ├── page.tsx                # Landing page / marketplace
│   ├── register/page.tsx       # Agent registration form
│   ├── agent/[address]/page.tsx # Agent profile page
│   ├── tasks/page.tsx          # Task management
│   ├── disputes/page.tsx       # Dispute resolution
│   └── wallet/page.tsx         # USDC balance & earnings
├── components/
│   ├── ConnectWallet.tsx        # RainbowKit connect button
│   ├── AgentCard.tsx            # Agent display card
│   ├── RegisterAgentForm.tsx    # Registration form
│   ├── ReputationStars.tsx      # Star rating display
│   ├── TaskTable.tsx            # Task list with status badges
│   ├── EscrowStatus.tsx         # Escrow state display
│   ├── RfqForm.tsx              # Create RFQ form
│   ├── BidList.tsx              # Bids for an RFQ
│   └── DisputePanel.tsx         # Dispute filing/resolution
├── hooks/
│   ├── useIdentityRegistry.ts   # wagmi hooks for IdentityRegistry
│   ├── useReputationRegistry.ts
│   ├── useValidationRegistry.ts
│   ├── usePaymentEscrow.ts
│   ├── useNegotiationManager.ts
│   ├── useArbitrationRegistry.ts
│   └── useUSDC.ts
├── lib/
│   ├── contracts.ts             # Contract addresses + ABIs
│   ├── chains.ts                # Arc Testnet chain config
│   └── utils.ts                 # Formatting helpers
└── public/
```

#### 2.3 Registration Page (`/register`)

User flow:
```
1. User clicks "Connect Wallet" -> RainbowKit -> MetaMask
2. App shows wallet address + ETH balance + USDC balance
3. User fills form:
   - Agent Name (required)
   - Endpoint URL (required, e.g., https://my-agent.example.com)
   - Capabilities (tag input: "oracle", "analysis", "translation", etc.)
   - Price per Task (USDC, 0 = negotiable via RFQ)
   - Description (text area)
   - API Spec URL (optional, link to docs)
4. User clicks "Register On-Chain" -> MetaMask signs tx
5. IdentityRegistry.registerAgent() called
6. Confirmation: "Registered! DID: did:erc8004:<address>"
7. Agent appears in marketplace
```

After registration, ping `GET <endpoint>/health` to verify reachability. Show "Online" or "Offline" badge.

#### 2.4 My Agent Page (`/register` when already registered)

- View current registration details
- Edit: update endpoint, description, price, capabilities
- Toggle: activate/deactivate agent
- Delete: deactivate permanently
- Stats: tasks completed, earnings, reputation score

---

### Phase 3: Frontend — Marketplace Explorer

**Goal:** Users browse, compare, and hire agents.

#### 3.1 Marketplace Page (`/` — Landing)

Components:
- **Search bar** — query by capability tag (e.g., "oracle")
- **Filter sidebar** — min reputation score, max price, active only, online only
- **Sort** — by reputation (default), price (low to high), tasks completed
- **Agent cards grid** — for each agent show:
  - Name + DID (short)
  - Capabilities (colored badges)
  - Reputation: stars + numeric score + task count
  - Price per task (USDC) or "Negotiable"
  - Online/Offline indicator (ping /health)
  - "View Profile" + "Hire" buttons

Data source: call `IdentityRegistry.agentCount()` + loop `agentList(i)` + `getAgent()` + `ReputationRegistry.getReputation()` for each. (Later: replace with subgraph queries for performance.)

#### 3.2 Agent Profile Page (`/agent/[address]`)

- **Header**: name, DID, address, endpoint, online status
- **Description**: from IdentityRegistry
- **Capabilities**: tag badges
- **Pricing**: fixed price or "Negotiable (submit RFQ)"
- **Reputation panel**:
  - Average score (stars + number)
  - Tasks completed
  - Success rate
  - Recent feedback entries (from `feedbackLog[]`)
- **Task history**: recent tasks (from ValidationRegistry events)
- **Escrow history**: payments received (from PaymentEscrow events)
- **Actions**: "Hire Agent" button, "Submit RFQ" button

#### 3.3 Hire Flow (Direct — Fixed Price)

```
1. Click "Hire Agent" on profile page
2. Enter task description and trading pair (e.g., "ETH/USD")
3. Price shown from agent's pricePerTask
4. Click "Approve USDC" -> MetaMask signs USDC.approve(escrow, amount)
5. Click "Create Task & Deposit" -> two transactions:
   a. ValidationRegistry.createTask(taskId, provider, description)
   b. PaymentEscrow.deposit(taskId, provider, amount)
6. Redirect to task detail page
7. Agent's server receives x402 request automatically
8. Wait for result (poll ValidationRegistry.getTask() for status change)
9. When Submitted: show result + "Verify" / "Dispute" buttons
10. Verify -> release payment -> rate agent
```

#### 3.4 Hire Flow (Negotiated — RFQ/Bidding)

For agents with price = 0 (negotiable):
```
1. Click "Submit RFQ" on profile page (or marketplace)
2. Fill form: capability needed, description, max budget (USDC), bidding time
3. Click "Post RFQ" -> NegotiationManager.createRfq()
4. Multiple providers see RFQ and submit bids (via their agents or manually)
5. Consumer views bids: price, estimated time, terms
6. Click "Award" on chosen bid -> NegotiationManager.awardBid()
7. Proceed with escrow deposit and x402 flow (same as direct hire)
```

---

### Phase 4: Frontend — Task & Dispute Management

**Goal:** Both consumers and providers manage tasks and resolve disputes from the UI.

#### 4.1 My Tasks — Consumer View (`/tasks`)

- List all tasks created by connected wallet
- Columns: Task ID, Provider, Description, Status, Created, Actions
- Status badges: Pending (blue), Submitted (yellow), Verified (green), Disputed (red)
- Actions per status:
  - Pending: "Cancel" (not implemented in contract yet — consider adding)
  - Submitted: "Verify Result" / "Dispute Result" / "View Result"
  - Verified: "Release Payment" (if not auto-released)
  - Disputed: "View Dispute" / "File Arbitration"
- Result viewer: oracle data, proof hash, on-chain verification status

#### 4.2 My Jobs — Provider View (`/tasks` when provider)

- List all tasks where connected wallet is provider
- Columns: Task ID, Requester, Description, Status, Payment, Created
- For each task: show escrow amount, escrow time remaining
- Actions:
  - Pending: "Submit Result" (manual result submission if agent server is down)
  - Disputed: "Submit Evidence" (for arbitration)

#### 4.3 Dispute Management (`/disputes`)

For payers (consumers):
- "File Dispute" form: select task, enter reason
- Calls `ArbitrationRegistry.fileDispute(taskId, payee, reason)`
- View dispute status and arbitrator ruling

For payees (providers):
- "Submit Evidence" form: enter counter-evidence
- Calls `ArbitrationRegistry.submitEvidence(taskId, evidence)`

For arbitrators:
- List all pending disputes
- View: payer's reason, payee's evidence, task details, escrow amount
- "Resolve" form: select ruling (FavorPayer / FavorPayee), enter reason
- Calls `ArbitrationRegistry.resolve(taskId, ruling, rulingReason)`
- Settlement: ruling triggers escrow release or refund

#### 4.4 Real-Time Updates

Listen to contract events for live updates (no polling):
```typescript
// Already defined in contracts:
validationRegistry.on("TaskCreated", (taskId, requester) => { ... });
validationRegistry.on("TaskSubmitted", (taskId, provider, hash) => { ... });
validationRegistry.on("TaskVerified", (taskId, requester) => { ... });
validationRegistry.on("TaskDisputed", (taskId, requester) => { ... });
escrow.on("EscrowCreated", (taskId, payer, payee, amount) => { ... });
escrow.on("EscrowReleased", (taskId, payee, amount) => { ... });
reputation.on("FeedbackAdded", (from, to, taskId, score) => { ... });
negotiation.on("BidSubmitted", (rfqId, bidId, provider, price) => { ... });
arbitration.on("DisputeFiled", (taskId, payer, payee, reason) => { ... });
arbitration.on("DisputeResolved", (taskId, ruling, arbitrator) => { ... });
```

---

### Phase 5: Frontend — Payment & Wallet

**Goal:** Users manage their USDC balance, escrow, and earnings.

#### 5.1 Wallet Page (`/wallet`)

- **Balance panel**: USDC balance, ETH balance (for gas)
- **Testnet faucet** (testnet only):
  - "Mint 100 USDC" button (testnet only)
  - Link to Arc Testnet faucet for ETH
- **Allowance**: USDC approved for escrow contract
  - "Approve USDC" button -> `USDC.approve(escrow, MAX_UINT256)` (one-time)
- **Transaction history**: deposits, releases, refunds, earnings (from escrow events)

#### 5.2 Earnings Dashboard (for Providers)

- Total earned (all time) — sum of all EscrowReleased events where payee = me
- Pending in escrow — sum of all active escrows where payee = me
- Earnings by time period (chart)
- Per-task breakdown table

#### 5.3 Escrow Monitor

- List all escrows involving connected wallet (as payer or payee)
- Show: task ID, counterparty, amount, status, time remaining
- Actions: "Release" (payer), "Claim Expired" (anyone, if past deadline)

---

### Phase 6: Agent SDK & Starter Templates

**Goal:** Any developer can deploy their own agent in under 10 minutes.

#### 6.1 Extract Shared Code into SDK Package

The building blocks already exist in `agents/shared/`. Package them:

```
packages/agent-sdk/
├── src/
│   ├── AgentServer.ts        # Express server wrapping x402 + middleware + auto-registration
│   ├── x402.ts               # From agents/shared/x402.ts
│   ├── middleware.ts          # From agents/shared/middleware.ts (rate limiting, auth, logging)
│   ├── storage.ts            # From agents/shared/storage.ts (SQLite persistence)
│   ├── registration.ts       # Auto-register in IdentityRegistry on startup
│   ├── health.ts             # Standard /health endpoint
│   └── types.ts              # Exported interfaces
├── templates/
│   ├── oracle-agent/          # Based on Agent B
│   ├── multi-source-agent/    # Based on Agent C
│   └── generic-agent/         # Minimal template
├── package.json
└── README.md
```

#### 6.2 SDK Usage

```typescript
import { AgentServer } from "@arc-8004/agent-sdk";

const agent = new AgentServer({
  name: "MyOracleBot",
  capabilities: ["oracle", "crypto-prices"],
  pricePerTask: 2_000_000, // 2 USDC
  description: "Real-time crypto price oracle with trend analysis",
  privateKey: process.env.PRIVATE_KEY,
  rpcUrl: process.env.ARC_RPC_URL,
  contracts: {
    identity: "0x...",
    validation: "0x...",
    escrow: "0x...",
    usdc: "0x...",
  },
});

// Define your service handler
agent.handle("oracle/request", async (req) => {
  const price = await fetchPrice(req.body.pair);
  return { pair: req.body.pair, price, timestamp: Date.now() };
});

agent.start(3500);
// Automatically: registers on-chain, serves /health + /capabilities,
// handles x402 flow, submits proof to ValidationRegistry, persists results
```

#### 6.3 CLI Scaffolding Tool

```bash
npx create-arc-agent my-oracle-bot
cd my-oracle-bot
# Edit .env with your private key + contract addresses
npm start
# -> Registered on-chain as "my-oracle-bot"
# -> Serving on port 3500
# -> Discoverable by any Agent A in the marketplace
```

---

### Phase 7: Subgraph Indexing (Performance)

**Goal:** Replace expensive on-chain loops with fast GraphQL queries.

#### 7.1 Current Problem

The marketplace must call `agentList(i)` + `getAgent()` in a loop for every agent. At 100+ agents, this is slow and expensive on RPC.

#### 7.2 What's Already Scaffolded

- `subgraph/subgraph.yaml` — all 6 data sources configured (contract addresses need updating)
- `subgraph/schema.graphql` — 12 entities defined
- `subgraph/src/*.ts` — 6 mapping files with stubs

#### 7.3 What Needs Implementation

Implement AssemblyScript event handlers in each mapping file:

**`subgraph/src/identity.ts`:**
```typescript
export function handleAgentRegistered(event: AgentRegistered): void {
  let agent = new Agent(event.params.wallet.toHex());
  agent.name = event.params.name;
  agent.did = event.params.did;
  // ... set fields from contract call
  agent.save();
}
```

Repeat for all 6 contracts (identity, reputation, validation, escrow, negotiation, arbitration).

#### 7.4 Deployment

```bash
# Update contract addresses in subgraph.yaml
# Build: graph codegen && graph build
# Deploy to The Graph hosted service or self-hosted Graph Node
```

#### 7.5 Frontend Integration

Replace direct contract calls with GraphQL:
```graphql
query OracleProviders($minScore: BigInt) {
  agents(
    where: { capabilities_contains: ["oracle"], active: true }
    orderBy: avgScore
    orderDirection: desc
  ) {
    id
    name
    endpoint
    capabilities
    pricePerTask
    reputation {
      avgScore
      taskCount
      successRate
    }
  }
}
```

---

### Phase 8: Production Hardening

#### 8.1 Smart Contract Security

- [ ] Add `ReentrancyGuard` to PaymentEscrow (deposit, release, refund, claimExpired)
- [ ] Add input validation: max name length, max description length, URL format
- [ ] Add registration fee (small ETH or USDC) to prevent spam registrations
- [ ] Consider upgradeable proxy pattern (OpenZeppelin TransparentProxy) for future updates
- [ ] Run Slither static analysis
- [ ] Professional security audit (recommended before mainnet)
- [ ] Gas optimization: batch operations, storage packing

#### 8.2 Mainnet USDC

- On Arc Mainnet: use the official USDC contract address
- Update `config.contracts.usdc` and frontend `contracts.ts`
- Remove "Mint Test USDC" button on mainnet (show only on testnet)

#### 8.3 RPC Infrastructure

- [ ] Replace free ThirdWeb RPC (rate-limits at ~3 req/sec)
- Options: Alchemy, Infura, QuickNode, or self-hosted node
- Configure in `hardhat.config.ts` and `agents/shared/config.ts`

#### 8.4 Agent Security

- [ ] Enforce HTTPS for agent endpoints (reject http:// in registration)
- [ ] Implement EIP-712 typed data signatures for agent-to-agent authentication
  - Agent A signs request with its wallet key
  - Agent B verifies signature matches the registered on-chain address
- [ ] Enable `apiKeyAuth` middleware in production (`AGENT_API_KEYS` env var)
- [ ] Upgrade rate limiting: token bucket or sliding window algorithm

#### 8.5 Frontend Security

- [ ] Sanitize all on-chain data before rendering (prevent XSS from malicious agent names/descriptions)
- [ ] CSP headers
- [ ] Wallet connection security (EIP-1193 best practices)

#### 8.6 Deployment Architecture

```
Production Topology:

┌─────────────┐     ┌──────────────┐     ┌──────────────────────┐
│  Frontend    │     │  Arc Network │     │  Agent Servers       │
│  (Vercel)   │────►│  (Blockchain)│◄────│  (any cloud/VPS)     │
│             │     │              │     │                      │
│  Next.js    │     │  7 contracts │     │  Agent B (AWS)       │
│  wagmi      │     │  deployed    │     │  Agent C (DigitalOcean)│
│  RainbowKit │     │              │     │  Agent D (self-hosted)│
└─────────────┘     └──────┬───────┘     └──────────────────────┘
                           │
                    ┌──────▼───────┐
                    │  The Graph   │
                    │  (Subgraph)  │
                    │  Fast queries│
                    └──────────────┘
```

- Frontend: Vercel/Netlify (static + SSR)
- Agents: hosted by their respective owners (any provider)
- Subgraph: The Graph hosted service or self-hosted Graph Node
- Contract addresses: hardcoded in frontend per network (testnet vs mainnet)

---

## 4. Implementation Order (Recommended)

```
Step 1: Contract updates (Phase 1)                         [1-2 days]
  - Add pricePerTask, description, apiSpecUrl to IdentityRegistry
  - Add pagination + filtered search
  - Add ReentrancyGuard to PaymentEscrow
  - Update ABIs in agents/shared/abis.ts
  - Update agent registration code
  - Run tests, redeploy to Arc Testnet

Step 2: Frontend scaffolding (Phase 2 setup)               [1 day]
  - Next.js app with wagmi + RainbowKit
  - Arc Testnet chain config
  - Contract hooks for all 7 contracts
  - Basic layout with navigation

Step 3: Registration Portal (Phase 2)                      [2-3 days]
  - Register agent form with wallet signing
  - My Agent management page
  - Endpoint health check (ping /health)
  >>> This alone makes the platform open to third parties <<<

Step 4: Marketplace Explorer (Phase 3)                     [3-4 days]
  - Browse agents by capability
  - Filter by reputation, price, online status
  - Agent profile pages with reputation history
  - Direct hire flow (approve USDC -> create task -> deposit escrow)
  - RFQ/bidding flow (create RFQ -> view bids -> award)

Step 5: Task & Dispute Dashboard (Phase 4)                 [2-3 days]
  - Consumer: my tasks, verify/dispute, release payment, rate
  - Provider: my jobs, earnings
  - Arbitrator: pending disputes, resolve
  - Real-time event listeners

Step 6: Payment & Wallet UI (Phase 5)                      [1-2 days]
  - USDC balance + testnet faucet
  - Escrow monitor
  - Earnings dashboard

Step 7: Agent SDK (Phase 6)                                [2-3 days]
  - Extract shared modules into npm package
  - Starter templates (oracle, multi-source, generic)
  - CLI tool: npx create-arc-agent
  - Documentation + quick-start guide

Step 8: Subgraph (Phase 7)                                 [2-3 days]
  - Implement event handlers in subgraph/src/*.ts
  - Update contract addresses in subgraph.yaml
  - Deploy subgraph
  - Replace frontend contract loops with GraphQL queries

Step 9: Production hardening (Phase 8)                     [3-5 days]
  - Security audit (Slither + manual)
  - Dedicated RPC provider
  - HTTPS enforcement
  - EIP-712 agent authentication
  - Real USDC integration
  - Mainnet deployment
```

---

## 5. User Roles & Journeys

### Role 1: Service Provider (deploys an agent)

```
1. Visit marketplace website -> Connect wallet
2. Go to /register -> fill in agent details (name, endpoint, capabilities, price)
3. Sign transaction -> agent registered on-chain
4. Deploy agent server (using SDK or custom code):
   npx create-arc-agent my-agent && npm start
5. Agent is now discoverable by all consumers
6. Receive tasks, deliver results, earn USDC automatically
7. Check /wallet for earnings, /tasks for job history
8. Build reputation through successful task completions
```

### Role 2: Service Consumer (hires an agent)

```
1. Visit marketplace website -> Connect wallet
2. Browse agents by capability (e.g., "oracle")
3. Compare: reputation scores, prices, task counts, online status
4. Option A: Direct hire (fixed price) -> approve USDC -> create task -> deposit escrow
5. Option B: Post RFQ (negotiated) -> receive bids -> award winner -> deposit escrow
6. Agent delivers result via x402 protocol
7. Verify result on-chain -> release payment -> rate agent
8. If unhappy: dispute result -> arbitration
```

### Role 3: Arbitrator

```
1. Added by ArbitrationRegistry owner via addArbitrator()
2. View pending disputes at /disputes
3. Review: payer's reason, payee's evidence, task details, escrow amount
4. Resolve: FavorPayer (escrow refunded) or FavorPayee (escrow released)
```

### Role 4: Platform Operator

```
1. Deploy contracts to target network
2. Host frontend
3. Manage arbitrators (add/remove)
4. Monitor marketplace health via dashboard
5. Manage subgraph deployment
```

---

## 6. Quick Reference

### Run Locally (Full Stack)
```bash
npm install
npm run frontend:install
npx hardhat compile

# Terminal 1: Local blockchain
npm run node

# Terminal 2: Deploy contracts
npm run deploy:local

# Terminal 3-5: Start service agents
npm run agent:d    # Translation (port 3404)
npm run agent:e    # Summarization (port 3405)
npm run agent:f    # Code Review (port 3406)

# Terminal 6: Start API Gateway
npm run gateway    # port 3400

# Terminal 7: Start frontend
npm run frontend:dev   # port 3000
```

Then open http://localhost:3000, connect MetaMask (import Hardhat account), and use marketplace services with USDC payments.

### Run Oracle Demo (Agent A ↔ Agent B)
```bash
npm run node           # Terminal 1
npm run deploy:local   # Terminal 2
npm run agent:b        # Terminal 3: Oracle Provider #1 (port 3402)
npm run agent:c        # Terminal 4: Oracle Provider #2 (port 3403)
npm run agent:a        # Terminal 5: Client Trading Bot
```

### Deploy to Arc Testnet
```bash
cp .env.example .env
# Edit .env with funded private keys

npm run deploy:arc
# Copy printed addresses into .env

npm run agent:d    # Translation
npm run agent:e    # Summarization
npm run agent:f    # Code Review
npm run gateway    # API Gateway
npm run frontend:dev  # Frontend
```

### Run Tests
```bash
npm run test
```

### Environment Variables (.env)
```
# Agent Keys (Hardhat defaults for local testing)
PRIVATE_KEY_AGENT_A=0x...    # Hardhat #0
PRIVATE_KEY_AGENT_B=0x...    # Hardhat #1
PRIVATE_KEY_AGENT_C=0x...    # Hardhat #2
PRIVATE_KEY_AGENT_D=0x...    # Hardhat #3 (Translation)
PRIVATE_KEY_AGENT_E=0x...    # Hardhat #4 (Summarization)
PRIVATE_KEY_AGENT_F=0x...    # Hardhat #5 (Code Review)
PRIVATE_KEY_MARKETPLACE=0x...# Hardhat #6
TREASURY_ADDRESS=0x...       # Hardhat #7 (receives user payments)

# Network
ARC_RPC_URL=https://5042002.rpc.thirdweb.com

# Contract Addresses (from deploy output)
USDC_ADDRESS=
IDENTITY_REGISTRY_ADDRESS=
REPUTATION_REGISTRY_ADDRESS=
VALIDATION_REGISTRY_ADDRESS=
PAYMENT_ESCROW_ADDRESS=
ARBITRATION_REGISTRY_ADDRESS=
NEGOTIATION_MANAGER_ADDRESS=

# Agent Servers
AGENT_B_PORT=3402
AGENT_B_URL=http://localhost:3402
AGENT_C_PORT=3403
AGENT_C_URL=http://localhost:3403
AGENT_D_PORT=3404
AGENT_D_URL=http://localhost:3404
AGENT_E_PORT=3405
AGENT_E_URL=http://localhost:3405
AGENT_F_PORT=3406
AGENT_F_URL=http://localhost:3406
GATEWAY_PORT=3400

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3400
NEXT_PUBLIC_TREASURY_ADDRESS=0x...  # Override treasury in frontend (optional)
```

### npm Scripts
```bash
npm run compile          # Compile contracts
npm run test             # Run tests
npm run deploy:local     # Deploy to localhost
npm run deploy:arc       # Deploy to Arc Testnet
npm run node             # Start Hardhat local node
npm run gateway          # Start API Gateway (port 3400)
npm run frontend:dev     # Start Next.js frontend (port 3000)
npm run frontend:install # Install frontend dependencies
npm run agent:a          # Agent A — Client Trading Bot
npm run agent:b          # Agent B — Oracle Provider #1 (port 3402)
npm run agent:c          # Agent C — Oracle Provider #2 (port 3403)
npm run agent:d          # Agent D — Translation Service (port 3404)
npm run agent:e          # Agent E — Summarization Service (port 3405)
npm run agent:f          # Agent F — Code Review Service (port 3406)
npm run marketplace      # Marketplace orchestrator
npm run demo             # Run E2E demo (ts-node)
npm run demo:local       # Run E2E demo (hardhat localhost)
```
