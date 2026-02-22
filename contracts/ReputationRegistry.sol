// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IValidationRegistry
 * @notice Minimal interface for task-gating reputation feedback.
 */
interface IValidationRegistry {
    struct TaskInfo {
        bytes32 taskId;
        address requester;
        address provider;
        string  taskDescription;
        bytes32 resultHash;
        string  resultUri;
        uint8   status;
        uint256 createdAt;
        uint256 completedAt;
    }
    function getTask(bytes32 _taskId) external view returns (TaskInfo memory);
}

/**
 * @title ReputationRegistry (ERC-8004 Compliant)
 * @notice Tracks on-chain reputation scores for AI agents.
 *         After each task completion, both parties submit feedback.
 *         Scores are stored as cumulative totals for transparency.
 *
 *         Feedback is gated: the sender must be a party (requester or provider)
 *         to a task that exists in the ValidationRegistry.
 */
contract ReputationRegistry {
    // ──────────────────────────────── Types ────────────────────────────────

    struct Reputation {
        uint256 totalScore;       // Cumulative score points
        uint256 taskCount;        // Number of rated tasks
        uint256 successCount;     // Tasks rated >= 3 out of 5
        uint256 lastUpdated;
    }

    struct FeedbackEntry {
        address fromAgent;
        address toAgent;
        bytes32 taskId;
        uint8   score;            // 1-5 scale
        string  comment;
        uint256 timestamp;
    }

    // ──────────────────────────────── State ────────────────────────────────

    IValidationRegistry public validationRegistry;
    mapping(address => Reputation) public reputations;
    FeedbackEntry[] public feedbackLog;

    // Prevent duplicate feedback per (sender, taskId)
    mapping(bytes32 => bool) public feedbackSubmitted;

    // ──────────────────────────────── Events ───────────────────────────────

    event FeedbackAdded(
        address indexed from,
        address indexed to,
        bytes32 indexed taskId,
        uint8 score
    );

    // ──────────────────────────────── Constructor ────────────────────────────

    /**
     * @param _validationRegistry Address of the ValidationRegistry contract.
     *        Used to verify task existence and party membership for feedback.
     */
    constructor(address _validationRegistry) {
        validationRegistry = IValidationRegistry(_validationRegistry);
    }

    // ──────────────────────────────── Write ────────────────────────────────

    /**
     * @notice Submit feedback for a completed task.
     *         Sender must be either the requester or provider of the task.
     *         Target must be the other party in the same task.
     * @param _toAgent  The agent being rated
     * @param _taskId   Unique task identifier (must exist in ValidationRegistry)
     * @param _score    Rating 1-5
     * @param _comment  Optional text feedback
     */
    function submitFeedback(
        address _toAgent,
        bytes32 _taskId,
        uint8   _score,
        string  calldata _comment
    ) external {
        require(_score >= 1 && _score <= 5, "Score must be 1-5");
        require(msg.sender != _toAgent, "Cannot rate yourself");

        // Verify task exists and sender is a party to it
        IValidationRegistry.TaskInfo memory task = validationRegistry.getTask(_taskId);
        require(task.createdAt != 0, "Task does not exist");
        require(
            msg.sender == task.requester || msg.sender == task.provider,
            "Not a party to this task"
        );
        require(
            _toAgent == task.requester || _toAgent == task.provider,
            "Target not a party to this task"
        );

        bytes32 key = keccak256(abi.encodePacked(msg.sender, _taskId));
        require(!feedbackSubmitted[key], "Already submitted for this task");
        feedbackSubmitted[key] = true;

        Reputation storage rep = reputations[_toAgent];
        rep.totalScore += _score;
        rep.taskCount++;
        if (_score >= 3) rep.successCount++;
        rep.lastUpdated = block.timestamp;

        feedbackLog.push(FeedbackEntry({
            fromAgent: msg.sender,
            toAgent: _toAgent,
            taskId: _taskId,
            score: _score,
            comment: _comment,
            timestamp: block.timestamp
        }));

        emit FeedbackAdded(msg.sender, _toAgent, _taskId, _score);
    }

    // ──────────────────────────────── Read ─────────────────────────────────

    /**
     * @notice Get the average score for an agent (scaled by 100 for precision).
     *         e.g. 450 means 4.50 average.
     */
    function getAverageScore(address _agent) external view returns (uint256) {
        Reputation storage rep = reputations[_agent];
        if (rep.taskCount == 0) return 0;
        return (rep.totalScore * 100) / rep.taskCount;
    }

    /**
     * @notice Get the success rate as a percentage (0-100).
     */
    function getSuccessRate(address _agent) external view returns (uint256) {
        Reputation storage rep = reputations[_agent];
        if (rep.taskCount == 0) return 0;
        return (rep.successCount * 100) / rep.taskCount;
    }

    /**
     * @notice Get the full reputation struct for an agent.
     */
    function getReputation(address _agent) external view returns (Reputation memory) {
        return reputations[_agent];
    }

    /**
     * @notice Get total feedback entries count.
     */
    function feedbackCount() external view returns (uint256) {
        return feedbackLog.length;
    }
}
