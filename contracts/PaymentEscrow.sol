// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PaymentEscrow (x402 Payment Layer)
 * @notice Implements the on-chain settlement for the x402 micropayment protocol.
 *
 *         Flow:
 *         1. Agent A deposits USDC into escrow for a specific task.
 *         2. Agent B completes the task and submits proof.
 *         3. Agent A verifies and calls `release()` — or the task's Validation
 *            Registry status triggers automatic release.
 *         4. Agent B receives USDC.
 *
 *         Includes timeout: if a task isn't completed within `deadline` seconds,
 *         anyone can call `claimExpired()` to refund the payer automatically.
 *
 *         Arbitration: the designated ArbitrationRegistry can freeze escrows
 *         during disputes and resolve them by releasing or refunding funds.
 */
contract PaymentEscrow {
    using SafeERC20 for IERC20;

    // ──────────────────────────────── Types ────────────────────────────────

    enum EscrowStatus { None, Funded, Released, Refunded, Expired }

    struct Escrow {
        bytes32      taskId;
        address      payer;        // Agent A
        address      payee;        // Agent B
        uint256      amount;       // USDC amount (6 decimals)
        EscrowStatus status;
        uint256      createdAt;
        uint256      deadline;     // Timestamp after which auto-refund is possible
    }

    // ──────────────────────────────── State ────────────────────────────────

    IERC20 public immutable usdc;
    address public owner;
    address public arbitrationContract;
    uint256 public defaultTimeout = 1 hours;
    uint256 public constant MIN_LOCK_DURATION = 10 minutes;
    mapping(bytes32 => Escrow) public escrows;
    mapping(bytes32 => bool) public disputeFrozen;

    // ──────────────────────────────── Events ───────────────────────────────

    event EscrowCreated(bytes32 indexed taskId, address indexed payer, address indexed payee, uint256 amount);
    event EscrowReleased(bytes32 indexed taskId, address indexed payee, uint256 amount);
    event EscrowRefunded(bytes32 indexed taskId, address indexed payer, uint256 amount);
    event EscrowExpired(bytes32 indexed taskId, address indexed payer, uint256 amount);
    event EscrowFrozen(bytes32 indexed taskId);
    event DefaultTimeoutUpdated(uint256 oldTimeout, uint256 newTimeout);
    event ArbitrationContractUpdated(address indexed oldArb, address indexed newArb);

    // ──────────────────────────────── Modifiers ─────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyArbitration() {
        require(msg.sender == arbitrationContract, "Only arbitration contract");
        _;
    }

    // ──────────────────────────────── Constructor ──────────────────────────

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
        owner = msg.sender;
    }

    // ──────────────────────────────── Admin ──────────────────────────────

    /**
     * @notice Set the ArbitrationRegistry contract address.
     *         Only this contract can freeze/resolve disputed escrows.
     */
    function setArbitrationContract(address _arb) external onlyOwner {
        emit ArbitrationContractUpdated(arbitrationContract, _arb);
        arbitrationContract = _arb;
    }

    /**
     * @notice Update the default escrow timeout duration.
     */
    function setDefaultTimeout(uint256 _timeout) external onlyOwner {
        require(_timeout >= 5 minutes, "Timeout too short");
        emit DefaultTimeoutUpdated(defaultTimeout, _timeout);
        defaultTimeout = _timeout;
    }

    // ──────────────────────────────── Write ────────────────────────────────

    /**
     * @notice Deposit USDC into escrow for a task (x402 step 1).
     *         Agent A must have approved this contract to spend `_amount`.
     *         Uses the default timeout for the escrow deadline.
     * @param _taskId  Task identifier matching ValidationRegistry
     * @param _payee   Agent B's address
     * @param _amount  USDC amount (6 decimals, e.g. 1_000_000 = 1 USDC)
     */
    function deposit(
        bytes32 _taskId,
        address _payee,
        uint256 _amount
    ) external {
        depositWithTimeout(_taskId, _payee, _amount, defaultTimeout);
    }

    /**
     * @notice Deposit USDC with a custom timeout duration.
     * @param _taskId   Task identifier matching ValidationRegistry
     * @param _payee    Agent B's address
     * @param _amount   USDC amount (6 decimals)
     * @param _timeout  Seconds until auto-refund becomes available (min 5 minutes)
     */
    function depositWithTimeout(
        bytes32 _taskId,
        address _payee,
        uint256 _amount,
        uint256 _timeout
    ) public {
        require(escrows[_taskId].status == EscrowStatus.None, "Escrow exists");
        require(_amount > 0, "Amount must be > 0");
        require(_timeout >= 5 minutes, "Timeout too short");

        escrows[_taskId] = Escrow({
            taskId: _taskId,
            payer: msg.sender,
            payee: _payee,
            amount: _amount,
            status: EscrowStatus.Funded,
            createdAt: block.timestamp,
            deadline: block.timestamp + _timeout
        });

        usdc.safeTransferFrom(msg.sender, address(this), _amount);
        emit EscrowCreated(_taskId, msg.sender, _payee, _amount);
    }

    /**
     * @notice Release escrowed USDC to the payee (x402 settlement).
     *         Can only be called by the original payer (Agent A).
     */
    function release(bytes32 _taskId) external {
        Escrow storage e = escrows[_taskId];
        require(e.status == EscrowStatus.Funded, "Not funded");
        require(e.payer == msg.sender, "Only payer can release");

        e.status = EscrowStatus.Released;
        usdc.safeTransfer(e.payee, e.amount);
        emit EscrowReleased(_taskId, e.payee, e.amount);
    }

    /**
     * @notice Refund escrowed USDC back to the payer.
     *         Can only be called by the original payer.
     *         Enforces a minimum lock period so providers have time to deliver.
     *         Cannot refund while a dispute is active.
     */
    function refund(bytes32 _taskId) external {
        Escrow storage e = escrows[_taskId];
        require(e.status == EscrowStatus.Funded, "Not funded");
        require(e.payer == msg.sender, "Only payer can refund");
        require(!disputeFrozen[_taskId], "Escrow frozen by dispute");
        require(
            block.timestamp >= e.createdAt + MIN_LOCK_DURATION,
            "Lock period not elapsed"
        );

        e.status = EscrowStatus.Refunded;
        usdc.safeTransfer(e.payer, e.amount);
        emit EscrowRefunded(_taskId, e.payer, e.amount);
    }

    /**
     * @notice Claim an expired escrow — auto-refund to payer after deadline.
     *         Can be called by anyone once the deadline has passed.
     *         Cannot claim while a dispute is active (frozen).
     */
    function claimExpired(bytes32 _taskId) external {
        Escrow storage e = escrows[_taskId];
        require(e.status == EscrowStatus.Funded, "Not funded");
        require(!disputeFrozen[_taskId], "Escrow frozen by dispute");
        require(block.timestamp > e.deadline, "Not expired yet");

        e.status = EscrowStatus.Expired;
        usdc.safeTransfer(e.payer, e.amount);
        emit EscrowExpired(_taskId, e.payer, e.amount);
    }

    // ──────────────────────────────── Arbitration ───────────────────────────

    /**
     * @notice Freeze an escrow during dispute resolution.
     *         Prevents refund and claimExpired while dispute is pending.
     *         Can only be called by the ArbitrationRegistry.
     */
    function freezeEscrow(bytes32 _taskId) external onlyArbitration {
        require(escrows[_taskId].status == EscrowStatus.Funded, "Not funded");
        disputeFrozen[_taskId] = true;
        emit EscrowFrozen(_taskId);
    }

    /**
     * @notice Resolve a disputed escrow by releasing or refunding.
     *         Can only be called by the ArbitrationRegistry after ruling.
     * @param _taskId     The disputed task
     * @param _favorPayee True = release to payee, False = refund to payer
     */
    function resolveDispute(bytes32 _taskId, bool _favorPayee) external onlyArbitration {
        Escrow storage e = escrows[_taskId];
        require(e.status == EscrowStatus.Funded, "Not funded");

        disputeFrozen[_taskId] = false;

        if (_favorPayee) {
            e.status = EscrowStatus.Released;
            usdc.safeTransfer(e.payee, e.amount);
            emit EscrowReleased(_taskId, e.payee, e.amount);
        } else {
            e.status = EscrowStatus.Refunded;
            usdc.safeTransfer(e.payer, e.amount);
            emit EscrowRefunded(_taskId, e.payer, e.amount);
        }
    }

    // ──────────────────────────────── Read ─────────────────────────────────

    /**
     * @notice Check whether an escrow has expired (past its deadline).
     */
    function isExpired(bytes32 _taskId) external view returns (bool) {
        Escrow storage e = escrows[_taskId];
        return e.status == EscrowStatus.Funded && !disputeFrozen[_taskId] && block.timestamp > e.deadline;
    }

    /**
     * @notice Returns the time remaining before an escrow expires (0 if already expired).
     */
    function timeRemaining(bytes32 _taskId) external view returns (uint256) {
        Escrow storage e = escrows[_taskId];
        if (e.status != EscrowStatus.Funded || block.timestamp >= e.deadline) return 0;
        return e.deadline - block.timestamp;
    }

    function getEscrow(bytes32 _taskId) external view returns (Escrow memory) {
        return escrows[_taskId];
    }
}
