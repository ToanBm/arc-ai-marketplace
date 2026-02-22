// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./PaymentEscrow.sol";

/**
 * @title ArbitrationRegistry
 * @notice Handles dispute resolution for the AI Agent Economy.
 *
 *         When Agent A disputes a result in the ValidationRegistry, the dispute
 *         is escalated here. A designated arbitrator reviews the evidence and
 *         decides whether to refund the payer or release funds to the provider.
 *
 *         Flow:
 *         1. Agent A files a dispute (referencing a taskId with Disputed status)
 *            → escrow is frozen to prevent expiry/refund during resolution
 *         2. Agent B submits counter-evidence
 *         3. Arbitrator reviews and submits ruling
 *         4. Funds are released or refunded based on the ruling
 */
contract ArbitrationRegistry {
    // ──────────────────────────────── Types ────────────────────────────────

    enum Ruling { Pending, FavorPayer, FavorPayee }

    struct Dispute {
        bytes32  taskId;
        address  payer;          // Agent A (requester)
        address  payee;          // Agent B (provider)
        string   reason;         // Payer's reason for dispute
        string   evidence;       // Payee's counter-evidence
        Ruling   ruling;
        address  arbitrator;     // Who resolved it
        string   rulingReason;
        uint256  filedAt;
        uint256  resolvedAt;
    }

    // ──────────────────────────────── State ────────────────────────────────

    mapping(bytes32 => Dispute) public disputes;
    bytes32[] public disputeIds;
    mapping(address => bool) public arbitrators;
    address public owner;
    PaymentEscrow public escrow;

    // ──────────────────────────────── Events ───────────────────────────────

    event DisputeFiled(bytes32 indexed taskId, address indexed payer, address indexed payee, string reason);
    event EvidenceSubmitted(bytes32 indexed taskId, address indexed payee, string evidence);
    event DisputeResolved(bytes32 indexed taskId, Ruling ruling, address arbitrator);
    event ArbitratorAdded(address indexed arbitrator);
    event ArbitratorRemoved(address indexed arbitrator);

    // ──────────────────────────────── Constructor ──────────────────────────

    constructor(address _escrow) {
        owner = msg.sender;
        escrow = PaymentEscrow(_escrow);
        arbitrators[msg.sender] = true; // Deployer is default arbitrator
    }

    // ──────────────────────────────── Modifiers ───────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyArbitrator() {
        require(arbitrators[msg.sender], "Not an arbitrator");
        _;
    }

    // ──────────────────────────────── Admin ───────────────────────────────

    function addArbitrator(address _arbitrator) external onlyOwner {
        arbitrators[_arbitrator] = true;
        emit ArbitratorAdded(_arbitrator);
    }

    function removeArbitrator(address _arbitrator) external onlyOwner {
        arbitrators[_arbitrator] = false;
        emit ArbitratorRemoved(_arbitrator);
    }

    // ──────────────────────────────── Write ────────────────────────────────

    /**
     * @notice File a dispute for a task. Only the payer can file.
     *         Freezes the escrow to prevent expiry/refund during resolution.
     * @param _taskId  The disputed task
     * @param _payee   The provider being disputed
     * @param _reason  Human-readable reason for the dispute
     */
    function fileDispute(
        bytes32 _taskId,
        address _payee,
        string calldata _reason
    ) external {
        require(disputes[_taskId].filedAt == 0, "Dispute already exists");

        // Verify escrow is funded (funds are locked)
        PaymentEscrow.Escrow memory e = escrow.getEscrow(_taskId);
        require(e.status == PaymentEscrow.EscrowStatus.Funded, "Escrow not funded");
        require(e.payer == msg.sender, "Only payer can file dispute");

        disputes[_taskId] = Dispute({
            taskId: _taskId,
            payer: msg.sender,
            payee: _payee,
            reason: _reason,
            evidence: "",
            ruling: Ruling.Pending,
            arbitrator: address(0),
            rulingReason: "",
            filedAt: block.timestamp,
            resolvedAt: 0
        });

        disputeIds.push(_taskId);

        // Freeze the escrow so it cannot expire or be refunded during dispute
        escrow.freezeEscrow(_taskId);

        emit DisputeFiled(_taskId, msg.sender, _payee, _reason);
    }

    /**
     * @notice Submit counter-evidence for a dispute. Only the payee can submit.
     */
    function submitEvidence(bytes32 _taskId, string calldata _evidence) external {
        Dispute storage d = disputes[_taskId];
        require(d.filedAt != 0, "Dispute does not exist");
        require(d.ruling == Ruling.Pending, "Already resolved");
        require(d.payee == msg.sender, "Only payee can submit evidence");

        d.evidence = _evidence;
        emit EvidenceSubmitted(_taskId, msg.sender, _evidence);
    }

    /**
     * @notice Resolve a dispute and execute fund transfer.
     *         Only a designated arbitrator can call this.
     *         FavorPayer = refund to payer, FavorPayee = release to provider.
     * @param _taskId       The disputed task
     * @param _ruling       FavorPayer (refund) or FavorPayee (release)
     * @param _rulingReason Human-readable reason for the ruling
     */
    function resolve(
        bytes32 _taskId,
        Ruling _ruling,
        string calldata _rulingReason
    ) external onlyArbitrator {
        Dispute storage d = disputes[_taskId];
        require(d.filedAt != 0, "Dispute does not exist");
        require(d.ruling == Ruling.Pending, "Already resolved");
        require(_ruling == Ruling.FavorPayer || _ruling == Ruling.FavorPayee, "Invalid ruling");

        d.ruling = _ruling;
        d.arbitrator = msg.sender;
        d.rulingReason = _rulingReason;
        d.resolvedAt = block.timestamp;

        // Execute fund transfer via escrow
        bool favorPayee = (_ruling == Ruling.FavorPayee);
        escrow.resolveDispute(_taskId, favorPayee);

        emit DisputeResolved(_taskId, _ruling, msg.sender);
    }

    // ──────────────────────────────── Read ─────────────────────────────────

    function getDispute(bytes32 _taskId) external view returns (Dispute memory) {
        return disputes[_taskId];
    }

    function disputeCount() external view returns (uint256) {
        return disputeIds.length;
    }
}
