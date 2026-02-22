import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("AI Agent Economy – Full Flow", function () {
  async function deployAll() {
    const [deployer, agentA, agentB, agentC, arbitrator] = await ethers.getSigners();

    // TestToken is used for local Hardhat testing only.
    // On Arc Testnet, real USDC at 0x3600000000000000000000000000000000000000 is used.
    const TestToken = await ethers.getContractFactory("TestToken");
    const usdc = await TestToken.deploy("USD Coin", "USDC", 6);

    const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
    const identity = await IdentityRegistry.deploy();

    const ValidationRegistry = await ethers.getContractFactory("ValidationRegistry");
    const validation = await ValidationRegistry.deploy();

    // ReputationRegistry now requires ValidationRegistry address
    const ReputationRegistry = await ethers.getContractFactory("ReputationRegistry");
    const reputation = await ReputationRegistry.deploy(await validation.getAddress());

    const PaymentEscrow = await ethers.getContractFactory("PaymentEscrow");
    const escrow = await PaymentEscrow.deploy(await usdc.getAddress());

    const ArbitrationRegistry = await ethers.getContractFactory("ArbitrationRegistry");
    const arbitration = await ArbitrationRegistry.deploy(await escrow.getAddress());

    // Wire up: PaymentEscrow needs to know ArbitrationRegistry
    await escrow.setArbitrationContract(await arbitration.getAddress());

    const NegotiationManager = await ethers.getContractFactory("NegotiationManager");
    const negotiation = await NegotiationManager.deploy();

    // Mint test tokens to Agent A (1000 USDC equivalent)
    await usdc.mint(agentA.address, 1_000_000_000n); // 1000 * 10^6

    return { deployer, agentA, agentB, agentC, arbitrator, usdc, identity, reputation, validation, escrow, arbitration, negotiation };
  }

  describe("IdentityRegistry", () => {
    it("should register Agent A and Agent B", async () => {
      const { agentA, agentB, identity } = await loadFixture(deployAll);

      await identity.connect(agentA).registerAgent("TradingBot-A", "http://localhost:3401", ["trading", "client"]);
      await identity.connect(agentB).registerAgent("OracleBot-B", "http://localhost:3402", ["oracle", "analysis"]);

      const a = await identity.getAgent(agentA.address);
      expect(a.name).to.equal("TradingBot-A");
      expect(a.active).to.be.true;

      const b = await identity.getAgent(agentB.address);
      expect(b.name).to.equal("OracleBot-B");
    });

    it("should find agents by capability", async () => {
      const { agentA, agentB, identity } = await loadFixture(deployAll);

      await identity.connect(agentA).registerAgent("TradingBot-A", "http://localhost:3401", ["trading"]);
      await identity.connect(agentB).registerAgent("OracleBot-B", "http://localhost:3402", ["oracle", "analysis"]);

      const oracles = await identity["findByCapability(string)"]("oracle");
      expect(oracles.length).to.equal(1);
      expect(oracles[0].name).to.equal("OracleBot-B");
    });

    it("should prevent duplicate registration", async () => {
      const { agentA, identity } = await loadFixture(deployAll);
      await identity.connect(agentA).registerAgent("Bot", "http://x", ["x"]);
      await expect(
        identity.connect(agentA).registerAgent("Bot2", "http://y", ["y"])
      ).to.be.revertedWith("Already registered");
    });

    it("should find multiple oracle providers (B and C)", async () => {
      const { agentB, agentC, identity } = await loadFixture(deployAll);

      await identity.connect(agentB).registerAgent("OracleBot-B", "http://localhost:3402", ["oracle", "analysis"]);
      await identity.connect(agentC).registerAgent("OracleBot-C", "http://localhost:3403", ["oracle", "multi-source"]);

      const oracles = await identity["findByCapability(string)"]("oracle");
      expect(oracles.length).to.equal(2);
    });

    it("should allow re-registration after deactivation without duplicates", async () => {
      const { agentA, identity } = await loadFixture(deployAll);

      await identity.connect(agentA).registerAgent("Bot-V1", "http://x", ["x"]);
      await identity.connect(agentA).deactivate();

      // Re-register should work
      await identity.connect(agentA).registerAgent("Bot-V2", "http://y", ["y"]);

      const agent = await identity.getAgent(agentA.address);
      expect(agent.name).to.equal("Bot-V2");
      expect(agent.active).to.be.true;

      // agentList should not have duplicates
      expect(await identity.agentCount()).to.equal(1n);
    });

    it("should update capabilities", async () => {
      const { agentA, identity } = await loadFixture(deployAll);

      await identity.connect(agentA).registerAgent("Bot", "http://x", ["oracle"]);
      await identity.connect(agentA).updateCapabilities(["oracle", "analysis", "sol-support"]);

      const agent = await identity.getAgent(agentA.address);
      expect(agent.capabilities.length).to.equal(3);
    });

    it("should support paginated findByCapability", async () => {
      const { agentA, agentB, agentC, identity } = await loadFixture(deployAll);

      await identity.connect(agentA).registerAgent("A", "http://a", ["oracle"]);
      await identity.connect(agentB).registerAgent("B", "http://b", ["oracle"]);
      await identity.connect(agentC).registerAgent("C", "http://c", ["oracle"]);

      // Get first 2
      const page1 = await identity["findByCapability(string,uint256,uint256)"]("oracle", 0, 2);
      expect(page1.length).to.equal(2);

      // Get next page
      const page2 = await identity["findByCapability(string,uint256,uint256)"]("oracle", 2, 2);
      expect(page2.length).to.equal(1);
    });
  });

  describe("ValidationRegistry", () => {
    it("should create task, submit result, verify, and check hash", async () => {
      const { agentA, agentB, validation } = await loadFixture(deployAll);

      const taskId = ethers.id("task-001");
      await validation.connect(agentA).createTask(taskId, agentB.address, "Fetch ETH/USD from Chainlink");

      const resultData = '{"price":"3500.00","trend":"bullish"}';
      const resultHash = ethers.id(resultData);

      await validation.connect(agentB).submitResult(taskId, resultHash, "ipfs://result001");

      // Verify hash matches
      expect(await validation.verifyHash(taskId, resultHash)).to.be.true;
      expect(await validation.verifyHash(taskId, ethers.id("wrong"))).to.be.false;

      // Agent A verifies
      await validation.connect(agentA).verifyResult(taskId);
      const task = await validation.getTask(taskId);
      expect(task.status).to.equal(2n); // Verified
    });

    it("should allow task cancellation", async () => {
      const { agentA, agentB, validation } = await loadFixture(deployAll);

      const taskId = ethers.id("task-cancel");
      await validation.connect(agentA).createTask(taskId, agentB.address, "Test task");

      await validation.connect(agentA).cancelTask(taskId);
      const task = await validation.getTask(taskId);
      expect(task.status).to.equal(4n); // Cancelled
    });

    it("should prevent non-requester from cancelling", async () => {
      const { agentA, agentB, validation } = await loadFixture(deployAll);

      const taskId = ethers.id("task-nocancel");
      await validation.connect(agentA).createTask(taskId, agentB.address, "Test task");

      await expect(
        validation.connect(agentB).cancelTask(taskId)
      ).to.be.revertedWith("Not the requester");
    });
  });

  describe("PaymentEscrow (x402)", () => {
    it("should deposit, release, and transfer USDC", async () => {
      const { agentA, agentB, usdc, escrow } = await loadFixture(deployAll);

      const taskId = ethers.id("task-001");
      const paymentAmount = 5_000_000n; // 5 USDC

      await usdc.connect(agentA).approve(await escrow.getAddress(), paymentAmount);
      await escrow.connect(agentA).deposit(taskId, agentB.address, paymentAmount);

      const e = await escrow.getEscrow(taskId);
      expect(e.status).to.equal(1n); // Funded
      expect(e.deadline).to.be.gt(0n);

      await escrow.connect(agentA).release(taskId);

      expect(await usdc.balanceOf(agentB.address)).to.equal(paymentAmount);
      const e2 = await escrow.getEscrow(taskId);
      expect(e2.status).to.equal(2n); // Released
    });

    it("should enforce lock period before refund", async () => {
      const { agentA, agentB, usdc, escrow } = await loadFixture(deployAll);

      const taskId = ethers.id("task-lock");
      const paymentAmount = 3_000_000n;

      await usdc.connect(agentA).approve(await escrow.getAddress(), paymentAmount);
      await escrow.connect(agentA).deposit(taskId, agentB.address, paymentAmount);

      // Immediate refund should fail (lock period)
      await expect(
        escrow.connect(agentA).refund(taskId)
      ).to.be.revertedWith("Lock period not elapsed");

      // Advance past lock period (10 minutes)
      await time.increase(601);

      // Now refund should work
      await escrow.connect(agentA).refund(taskId);
      const e = await escrow.getEscrow(taskId);
      expect(e.status).to.equal(3n); // Refunded
    });

    it("should support custom timeout via depositWithTimeout", async () => {
      const { agentA, agentB, usdc, escrow } = await loadFixture(deployAll);

      const taskId = ethers.id("task-timeout");
      const paymentAmount = 5_000_000n;
      const customTimeout = 600; // 10 minutes

      await usdc.connect(agentA).approve(await escrow.getAddress(), paymentAmount);
      await escrow.connect(agentA).depositWithTimeout(taskId, agentB.address, paymentAmount, customTimeout);

      const e = await escrow.getEscrow(taskId);
      expect(e.status).to.equal(1n);
      expect(e.deadline).to.equal(e.createdAt + BigInt(customTimeout));
    });

    it("should reject timeout shorter than 5 minutes", async () => {
      const { agentA, agentB, usdc, escrow } = await loadFixture(deployAll);

      const taskId = ethers.id("task-short-timeout");
      const paymentAmount = 5_000_000n;

      await usdc.connect(agentA).approve(await escrow.getAddress(), paymentAmount);
      await expect(
        escrow.connect(agentA).depositWithTimeout(taskId, agentB.address, paymentAmount, 60)
      ).to.be.revertedWith("Timeout too short");
    });

    it("should allow claimExpired after deadline passes", async () => {
      const { agentA, agentB, usdc, escrow } = await loadFixture(deployAll);

      const taskId = ethers.id("task-expire");
      const paymentAmount = 5_000_000n;
      const timeout = 300;

      const balBefore = await usdc.balanceOf(agentA.address);

      await usdc.connect(agentA).approve(await escrow.getAddress(), paymentAmount);
      await escrow.connect(agentA).depositWithTimeout(taskId, agentB.address, paymentAmount, timeout);

      expect(await escrow.isExpired(taskId)).to.be.false;
      await expect(
        escrow.connect(agentB).claimExpired(taskId)
      ).to.be.revertedWith("Not expired yet");

      await time.increase(timeout + 1);

      expect(await escrow.isExpired(taskId)).to.be.true;
      expect(await escrow.timeRemaining(taskId)).to.equal(0n);

      await escrow.connect(agentB).claimExpired(taskId);

      const e = await escrow.getEscrow(taskId);
      expect(e.status).to.equal(4n); // Expired
      expect(await usdc.balanceOf(agentA.address)).to.equal(balBefore);
    });

    it("should prevent claimExpired when dispute-frozen", async () => {
      const { agentA, agentB, usdc, escrow, arbitration } = await loadFixture(deployAll);

      const taskId = ethers.id("task-frozen-expire");
      const paymentAmount = 5_000_000n;
      const timeout = 300;

      await usdc.connect(agentA).approve(await escrow.getAddress(), paymentAmount);
      await escrow.connect(agentA).depositWithTimeout(taskId, agentB.address, paymentAmount, timeout);

      // File dispute (freezes escrow)
      await arbitration.connect(agentA).fileDispute(taskId, agentB.address, "Bad data");

      // Advance past deadline
      await time.increase(timeout + 1);

      // claimExpired should fail because escrow is frozen
      await expect(
        escrow.connect(agentB).claimExpired(taskId)
      ).to.be.revertedWith("Escrow frozen by dispute");
    });
  });

  describe("ReputationRegistry", () => {
    it("should track feedback and compute scores (task-gated)", async () => {
      const { agentA, agentB, reputation, validation } = await loadFixture(deployAll);

      // Must create a task first for feedback to be accepted
      const taskId = ethers.id("task-001");
      await validation.connect(agentA).createTask(taskId, agentB.address, "Test task");

      await reputation.connect(agentA).submitFeedback(agentB.address, taskId, 5, "Excellent oracle data");
      await reputation.connect(agentB).submitFeedback(agentA.address, taskId, 4, "Prompt payment");

      expect(await reputation.getAverageScore(agentB.address)).to.equal(500n);
      expect(await reputation.getSuccessRate(agentB.address)).to.equal(100n);
      expect(await reputation.getAverageScore(agentA.address)).to.equal(400n);
    });

    it("should prevent feedback from non-party", async () => {
      const { agentA, agentB, agentC, reputation, validation } = await loadFixture(deployAll);

      const taskId = ethers.id("task-gate");
      await validation.connect(agentA).createTask(taskId, agentB.address, "Test task");

      // Agent C is not a party to this task
      await expect(
        reputation.connect(agentC).submitFeedback(agentB.address, taskId, 5, "")
      ).to.be.revertedWith("Not a party to this task");
    });

    it("should prevent feedback for non-existent task", async () => {
      const { agentA, agentB, reputation } = await loadFixture(deployAll);

      const fakeTaskId = ethers.id("fake-task");
      await expect(
        reputation.connect(agentA).submitFeedback(agentB.address, fakeTaskId, 5, "")
      ).to.be.revertedWith("Task does not exist");
    });

    it("should prevent self-rating and duplicate feedback", async () => {
      const { agentA, agentB, reputation, validation } = await loadFixture(deployAll);
      const taskId = ethers.id("task-001");
      await validation.connect(agentA).createTask(taskId, agentB.address, "Test");

      await expect(
        reputation.connect(agentA).submitFeedback(agentA.address, taskId, 5, "")
      ).to.be.revertedWith("Cannot rate yourself");

      await reputation.connect(agentA).submitFeedback(agentB.address, taskId, 4, "");
      await expect(
        reputation.connect(agentA).submitFeedback(agentB.address, taskId, 5, "")
      ).to.be.revertedWith("Already submitted for this task");
    });
  });

  describe("NegotiationManager", () => {
    it("should create RFQ, accept bids, and award winner", async () => {
      const { agentA, agentB, agentC, negotiation } = await loadFixture(deployAll);

      const rfqId = ethers.id("rfq-001");
      const maxBudget = 10_000_000n;

      await negotiation.connect(agentA).createRfq(
        rfqId, "oracle", "ETH/USD price + trend", maxBudget, 3600
      );

      const rfq = await negotiation.getRfq(rfqId);
      expect(rfq.requester).to.equal(agentA.address);
      expect(rfq.status).to.equal(0n);

      const bidB = ethers.id("bid-B");
      await negotiation.connect(agentB).submitBid(
        rfqId, bidB, 5_000_000n, 30, "Standard oracle service"
      );

      const bidC = ethers.id("bid-C");
      await negotiation.connect(agentC).submitBid(
        rfqId, bidC, 3_000_000n, 20, "Multi-source aggregated data"
      );

      const bids = await negotiation.getBidsForRfq(rfqId);
      expect(bids.length).to.equal(2);

      await negotiation.connect(agentA).awardBid(rfqId, bidC);

      const rfqAfter = await negotiation.getRfq(rfqId);
      expect(rfqAfter.status).to.equal(1n);
      expect(rfqAfter.winningBidId).to.equal(bidC);

      const winBid = await negotiation.getBid(bidC);
      expect(winBid.status).to.equal(1n);

      const loseBid = await negotiation.getBid(bidB);
      expect(loseBid.status).to.equal(2n);
    });

    it("should prevent bidding on own RFQ", async () => {
      const { agentA, negotiation } = await loadFixture(deployAll);

      const rfqId = ethers.id("rfq-own");
      await negotiation.connect(agentA).createRfq(rfqId, "oracle", "test", 10_000_000n, 3600);

      await expect(
        negotiation.connect(agentA).submitBid(rfqId, ethers.id("bid-self"), 5_000_000n, 30, "")
      ).to.be.revertedWith("Cannot bid on own RFQ");
    });

    it("should prevent bids exceeding budget", async () => {
      const { agentA, agentB, negotiation } = await loadFixture(deployAll);

      const rfqId = ethers.id("rfq-budget");
      await negotiation.connect(agentA).createRfq(rfqId, "oracle", "test", 5_000_000n, 3600);

      await expect(
        negotiation.connect(agentB).submitBid(rfqId, ethers.id("bid-over"), 6_000_000n, 30, "")
      ).to.be.revertedWith("Price exceeds budget");
    });

    it("should allow bid withdrawal", async () => {
      const { agentA, agentB, negotiation } = await loadFixture(deployAll);

      const rfqId = ethers.id("rfq-withdraw");
      await negotiation.connect(agentA).createRfq(rfqId, "oracle", "test", 10_000_000n, 3600);

      const bidId = ethers.id("bid-withdraw");
      await negotiation.connect(agentB).submitBid(rfqId, bidId, 5_000_000n, 30, "");

      await negotiation.connect(agentB).withdrawBid(bidId);
      const bid = await negotiation.getBid(bidId);
      expect(bid.status).to.equal(3n);
    });
  });

  describe("ArbitrationRegistry", () => {
    it("should file dispute, freeze escrow, submit evidence, and resolve (funds move)", async () => {
      const { deployer, agentA, agentB, usdc, escrow, arbitration } = await loadFixture(deployAll);

      const taskId = ethers.id("task-dispute");
      const paymentAmount = 5_000_000n;

      // Setup: deposit escrow
      await usdc.connect(agentA).approve(await escrow.getAddress(), paymentAmount);
      await escrow.connect(agentA).deposit(taskId, agentB.address, paymentAmount);

      // Agent A files a dispute (escrow gets frozen)
      await arbitration.connect(agentA).fileDispute(
        taskId, agentB.address, "Oracle data was inaccurate"
      );

      // Verify escrow is frozen
      expect(await escrow.disputeFrozen(taskId)).to.be.true;

      const dispute = await arbitration.getDispute(taskId);
      expect(dispute.payer).to.equal(agentA.address);
      expect(dispute.payee).to.equal(agentB.address);
      expect(dispute.ruling).to.equal(0n);

      // Agent B submits evidence
      await arbitration.connect(agentB).submitEvidence(
        taskId, "Data was sourced from CoinGecko at timestamp X, matching market price"
      );

      const disputeWithEvidence = await arbitration.getDispute(taskId);
      expect(disputeWithEvidence.evidence).to.include("CoinGecko");

      // Deployer (arbitrator) resolves in favor of payee — funds release to Agent B
      const balBBefore = await usdc.balanceOf(agentB.address);
      await arbitration.connect(deployer).resolve(
        taskId, 2, "Evidence shows data was accurate"  // 2 = FavorPayee
      );

      const resolved = await arbitration.getDispute(taskId);
      expect(resolved.ruling).to.equal(2n);
      expect(resolved.arbitrator).to.equal(deployer.address);

      // Verify funds were actually transferred to Agent B
      expect(await usdc.balanceOf(agentB.address)).to.equal(balBBefore + paymentAmount);

      // Verify escrow is no longer frozen and status is Released
      expect(await escrow.disputeFrozen(taskId)).to.be.false;
      const e = await escrow.getEscrow(taskId);
      expect(e.status).to.equal(2n); // Released
    });

    it("should resolve in favor of payer (refund)", async () => {
      const { deployer, agentA, agentB, usdc, escrow, arbitration } = await loadFixture(deployAll);

      const taskId = ethers.id("task-dispute-refund");
      const paymentAmount = 5_000_000n;
      const balABefore = await usdc.balanceOf(agentA.address);

      await usdc.connect(agentA).approve(await escrow.getAddress(), paymentAmount);
      await escrow.connect(agentA).deposit(taskId, agentB.address, paymentAmount);

      await arbitration.connect(agentA).fileDispute(taskId, agentB.address, "Wrong data");

      // Resolve in favor of payer → refund
      await arbitration.connect(deployer).resolve(taskId, 1, "Data was indeed wrong"); // 1 = FavorPayer

      // Funds refunded to Agent A
      expect(await usdc.balanceOf(agentA.address)).to.equal(balABefore);
      const e = await escrow.getEscrow(taskId);
      expect(e.status).to.equal(3n); // Refunded
    });

    it("should prevent non-payer from filing dispute", async () => {
      const { agentA, agentB, usdc, escrow, arbitration } = await loadFixture(deployAll);

      const taskId = ethers.id("task-unauthorized");
      const paymentAmount = 5_000_000n;

      await usdc.connect(agentA).approve(await escrow.getAddress(), paymentAmount);
      await escrow.connect(agentA).deposit(taskId, agentB.address, paymentAmount);

      await expect(
        arbitration.connect(agentB).fileDispute(taskId, agentA.address, "Test")
      ).to.be.revertedWith("Only payer can file dispute");
    });

    it("should prevent non-arbitrator from resolving", async () => {
      const { agentA, agentB, usdc, escrow, arbitration } = await loadFixture(deployAll);

      const taskId = ethers.id("task-nonauth");
      const paymentAmount = 5_000_000n;

      await usdc.connect(agentA).approve(await escrow.getAddress(), paymentAmount);
      await escrow.connect(agentA).deposit(taskId, agentB.address, paymentAmount);
      await arbitration.connect(agentA).fileDispute(taskId, agentB.address, "Test");

      await expect(
        arbitration.connect(agentA).resolve(taskId, 1, "Self-resolve attempt")
      ).to.be.revertedWith("Not an arbitrator");
    });

    it("should manage arbitrator roles", async () => {
      const { deployer, arbitrator, arbitration } = await loadFixture(deployAll);

      expect(await arbitration.arbitrators(deployer.address)).to.be.true;
      expect(await arbitration.arbitrators(arbitrator.address)).to.be.false;

      await arbitration.connect(deployer).addArbitrator(arbitrator.address);
      expect(await arbitration.arbitrators(arbitrator.address)).to.be.true;

      await arbitration.connect(deployer).removeArbitrator(arbitrator.address);
      expect(await arbitration.arbitrators(arbitrator.address)).to.be.false;
    });
  });

  describe("End-to-End Workflow", () => {
    it("should run the complete agent economy flow with multi-provider", async () => {
      const { agentA, agentB, agentC, usdc, identity, reputation, validation, escrow } =
        await loadFixture(deployAll);

      // ── Step 1: Discovery – All three agents register ──
      await identity.connect(agentA).registerAgent("TradingBot-A", "http://localhost:3401", ["trading", "client"]);
      await identity.connect(agentB).registerAgent("OracleBot-B", "http://localhost:3402", ["oracle", "analysis"]);
      await identity.connect(agentC).registerAgent("OracleBot-C", "http://localhost:3403", ["oracle", "multi-source"]);

      const oracles = await identity["findByCapability(string)"]("oracle");
      expect(oracles.length).to.equal(2);

      const providerAddr = oracles[0].wallet;

      // ── Step 2: Task Creation ──
      const taskId = ethers.id("ethusd-oracle-001");
      await validation.connect(agentA).createTask(taskId, providerAddr, "Fetch ETH/USD + trend analysis");

      // ── Step 3: Escrow Deposit ──
      const paymentAmount = 5_000_000n;
      await usdc.connect(agentA).approve(await escrow.getAddress(), paymentAmount);
      await escrow.connect(agentA).deposit(taskId, providerAddr, paymentAmount);

      const escrowData = await escrow.getEscrow(taskId);
      expect(escrowData.deadline).to.be.gt(escrowData.createdAt);

      // ── Step 4: Provider does work ──
      const oracleResult = JSON.stringify({
        pair: "ETH/USD",
        price: "3521.47",
        trend: "bullish",
        confidence: 0.87,
        timestamp: Date.now(),
      });
      const resultHash = ethers.id(oracleResult);
      await validation.connect(agentB).submitResult(taskId, resultHash, "ipfs://Qm...");

      // ── Step 5: Verification ──
      expect(await validation.verifyHash(taskId, resultHash)).to.be.true;
      await validation.connect(agentA).verifyResult(taskId);

      // ── Step 6: Payment Release ──
      await escrow.connect(agentA).release(taskId);
      expect(await usdc.balanceOf(agentB.address)).to.equal(paymentAmount);

      // ── Step 7: Mutual Reputation Update (task-gated) ──
      await reputation.connect(agentA).submitFeedback(agentB.address, taskId, 5, "Accurate oracle data with trend analysis");
      await reputation.connect(agentB).submitFeedback(agentA.address, taskId, 5, "Fast verification and payment");

      expect(await reputation.getAverageScore(agentB.address)).to.equal(500n);
      expect(await reputation.getAverageScore(agentA.address)).to.equal(500n);

      console.log("\n  Full agent economy workflow completed successfully!");
    });
  });
});
