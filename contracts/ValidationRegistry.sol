// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ValidationRegistry (ERC-8004 Compliant)
 * @notice Stores proof-of-work for tasks completed by AI agents.
 *         Agent B submits a hash of the result data, allowing Agent A
 *         to verify the work was done correctly before releasing payment.
 */
contract ValidationRegistry {
    // ──────────────────────────────── Types ────────────────────────────────

    enum TaskStatus { Pending, Submitted, Verified, Disputed, Cancelled }

    struct TaskRecord {
        bytes32    taskId;
        address    requester;      // Agent A
        address    provider;       // Agent B
        string     taskDescription;
        bytes32    resultHash;     // keccak256 of the result payload
        string     resultUri;      // Off-chain URI to full result data
        TaskStatus status;
        uint256    createdAt;
        uint256    completedAt;
    }

    // ──────────────────────────────── State ────────────────────────────────

    mapping(bytes32 => TaskRecord) public tasks;
    bytes32[] public taskIds;

    // ──────────────────────────────── Events ───────────────────────────────

    event TaskCreated(bytes32 indexed taskId, address indexed requester, string description);
    event TaskSubmitted(bytes32 indexed taskId, address indexed provider, bytes32 resultHash);
    event TaskVerified(bytes32 indexed taskId, address indexed requester);
    event TaskDisputed(bytes32 indexed taskId, address indexed requester);
    event TaskCancelled(bytes32 indexed taskId, address indexed requester);

    // ──────────────────────────────── Write ────────────────────────────────

    /**
     * @notice Create a new task request. Called by Agent A (requester).
     * @param _taskId      Unique identifier for the task
     * @param _provider    Assigned provider (Agent B)
     * @param _description Human-readable task description
     */
    function createTask(
        bytes32 _taskId,
        address _provider,
        string calldata _description
    ) external {
        require(tasks[_taskId].createdAt == 0, "Task already exists");

        tasks[_taskId] = TaskRecord({
            taskId: _taskId,
            requester: msg.sender,
            provider: _provider,
            taskDescription: _description,
            resultHash: bytes32(0),
            resultUri: "",
            status: TaskStatus.Pending,
            createdAt: block.timestamp,
            completedAt: 0
        });

        taskIds.push(_taskId);
        emit TaskCreated(_taskId, msg.sender, _description);
    }

    /**
     * @notice Submit proof-of-work for a task. Called by Agent B (provider).
     * @param _taskId     The task being completed
     * @param _resultHash keccak256 hash of the result data
     * @param _resultUri  Off-chain URI to the full result
     */
    function submitResult(
        bytes32 _taskId,
        bytes32 _resultHash,
        string calldata _resultUri
    ) external {
        TaskRecord storage task = tasks[_taskId];
        require(task.createdAt != 0, "Task does not exist");
        require(task.provider == msg.sender, "Not the assigned provider");
        require(task.status == TaskStatus.Pending, "Task not pending");

        task.resultHash = _resultHash;
        task.resultUri = _resultUri;
        task.status = TaskStatus.Submitted;
        task.completedAt = block.timestamp;

        emit TaskSubmitted(_taskId, msg.sender, _resultHash);
    }

    /**
     * @notice Verify submitted result. Called by Agent A (requester).
     *         Agent A checks the result off-chain, then marks it verified.
     */
    function verifyResult(bytes32 _taskId) external {
        TaskRecord storage task = tasks[_taskId];
        require(task.requester == msg.sender, "Not the requester");
        require(task.status == TaskStatus.Submitted, "Not submitted");

        task.status = TaskStatus.Verified;
        emit TaskVerified(_taskId, msg.sender);
    }

    /**
     * @notice Dispute a submitted result. Called by Agent A if verification fails.
     */
    function disputeResult(bytes32 _taskId) external {
        TaskRecord storage task = tasks[_taskId];
        require(task.requester == msg.sender, "Not the requester");
        require(task.status == TaskStatus.Submitted, "Not submitted");

        task.status = TaskStatus.Disputed;
        emit TaskDisputed(_taskId, msg.sender);
    }

    /**
     * @notice Cancel a pending task. Called by the requester if the provider
     *         never submits a result. Only works for Pending tasks.
     */
    function cancelTask(bytes32 _taskId) external {
        TaskRecord storage task = tasks[_taskId];
        require(task.requester == msg.sender, "Not the requester");
        require(task.status == TaskStatus.Pending, "Task not pending");

        task.status = TaskStatus.Cancelled;
        emit TaskCancelled(_taskId, msg.sender);
    }

    // ──────────────────────────────── Read ─────────────────────────────────

    function getTask(bytes32 _taskId) external view returns (TaskRecord memory) {
        return tasks[_taskId];
    }

    /**
     * @notice Verify a result hash matches what's on-chain.
     * @param _taskId     Task to check
     * @param _dataHash   Hash to compare against stored resultHash
     * @return matches    True if hashes match
     */
    function verifyHash(bytes32 _taskId, bytes32 _dataHash)
        external
        view
        returns (bool matches)
    {
        return tasks[_taskId].resultHash == _dataHash;
    }

    function taskCount() external view returns (uint256) {
        return taskIds.length;
    }
}
