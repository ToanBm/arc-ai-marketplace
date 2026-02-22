/**
 * Minimal ABIs for agent-side contract interaction.
 * These are subsets of the full ABIs — just the functions agents call.
 */

export const IDENTITY_REGISTRY_ABI = [
  "function registerAgent(string _name, string _endpoint, string[] _capabilities) external",
  "function updateEndpoint(string _endpoint) external",
  "function updateCapabilities(string[] _capabilities) external",
  "function deactivate() external",
  "function getAgent(address _wallet) external view returns (tuple(address wallet, string name, string did, string endpoint, string[] capabilities, uint256 registeredAt, bool active))",
  "function findByCapability(string _capability) external view returns (tuple(address wallet, string name, string did, string endpoint, string[] capabilities, uint256 registeredAt, bool active)[])",
  "function findByCapability(string _capability, uint256 _offset, uint256 _limit) external view returns (tuple(address wallet, string name, string did, string endpoint, string[] capabilities, uint256 registeredAt, bool active)[])",
  "function agentCount() external view returns (uint256)",
  "event AgentRegistered(address indexed wallet, string did, string name)",
  "event AgentCapabilitiesUpdated(address indexed wallet)",
];

export const REPUTATION_REGISTRY_ABI = [
  "function submitFeedback(address _toAgent, bytes32 _taskId, uint8 _score, string _comment) external",
  "function getAverageScore(address _agent) external view returns (uint256)",
  "function getSuccessRate(address _agent) external view returns (uint256)",
  "function getReputation(address _agent) external view returns (tuple(uint256 totalScore, uint256 taskCount, uint256 successCount, uint256 lastUpdated))",
  "event FeedbackAdded(address indexed from, address indexed to, bytes32 indexed taskId, uint8 score)",
];

export const VALIDATION_REGISTRY_ABI = [
  "function createTask(bytes32 _taskId, address _provider, string _description) external",
  "function submitResult(bytes32 _taskId, bytes32 _resultHash, string _resultUri) external",
  "function verifyResult(bytes32 _taskId) external",
  "function disputeResult(bytes32 _taskId) external",
  "function cancelTask(bytes32 _taskId) external",
  "function getTask(bytes32 _taskId) external view returns (tuple(bytes32 taskId, address requester, address provider, string taskDescription, bytes32 resultHash, string resultUri, uint8 status, uint256 createdAt, uint256 completedAt))",
  "function verifyHash(bytes32 _taskId, bytes32 _dataHash) external view returns (bool)",
  "event TaskCreated(bytes32 indexed taskId, address indexed requester, string description)",
  "event TaskSubmitted(bytes32 indexed taskId, address indexed provider, bytes32 resultHash)",
  "event TaskVerified(bytes32 indexed taskId, address indexed requester)",
  "event TaskCancelled(bytes32 indexed taskId, address indexed requester)",
];

export const PAYMENT_ESCROW_ABI = [
  "function deposit(bytes32 _taskId, address _payee, uint256 _amount) external",
  "function depositWithTimeout(bytes32 _taskId, address _payee, uint256 _amount, uint256 _timeout) external",
  "function release(bytes32 _taskId) external",
  "function refund(bytes32 _taskId) external",
  "function claimExpired(bytes32 _taskId) external",
  "function setArbitrationContract(address _arb) external",
  "function setDefaultTimeout(uint256 _timeout) external",
  "function freezeEscrow(bytes32 _taskId) external",
  "function resolveDispute(bytes32 _taskId, bool _favorPayee) external",
  "function isExpired(bytes32 _taskId) external view returns (bool)",
  "function timeRemaining(bytes32 _taskId) external view returns (uint256)",
  "function defaultTimeout() external view returns (uint256)",
  "function disputeFrozen(bytes32 _taskId) external view returns (bool)",
  "function getEscrow(bytes32 _taskId) external view returns (tuple(bytes32 taskId, address payer, address payee, uint256 amount, uint8 status, uint256 createdAt, uint256 deadline))",
  "event EscrowCreated(bytes32 indexed taskId, address indexed payer, address indexed payee, uint256 amount)",
  "event EscrowReleased(bytes32 indexed taskId, address indexed payee, uint256 amount)",
  "event EscrowRefunded(bytes32 indexed taskId, address indexed payer, uint256 amount)",
  "event EscrowExpired(bytes32 indexed taskId, address indexed payer, uint256 amount)",
  "event EscrowFrozen(bytes32 indexed taskId)",
];

export const NEGOTIATION_MANAGER_ABI = [
  "function createRfq(bytes32 _rfqId, string _capability, string _description, uint256 _maxBudget, uint256 _biddingTime) external",
  "function submitBid(bytes32 _rfqId, bytes32 _bidId, uint256 _price, uint256 _estimatedTime, string _terms) external",
  "function awardBid(bytes32 _rfqId, bytes32 _bidId) external",
  "function cancelRfq(bytes32 _rfqId) external",
  "function withdrawBid(bytes32 _bidId) external",
  "function getRfq(bytes32 _rfqId) external view returns (tuple(bytes32 rfqId, address requester, string capability, string description, uint256 maxBudget, uint256 deadline, uint8 status, bytes32 winningBidId, uint256 createdAt, uint256 bidCount))",
  "function getBid(bytes32 _bidId) external view returns (tuple(bytes32 bidId, bytes32 rfqId, address provider, uint256 price, uint256 estimatedTime, string terms, uint8 status, uint256 submittedAt))",
  "function getBidsForRfq(bytes32 _rfqId) external view returns (tuple(bytes32 bidId, bytes32 rfqId, address provider, uint256 price, uint256 estimatedTime, string terms, uint8 status, uint256 submittedAt)[])",
  "function rfqCount() external view returns (uint256)",
  "event RfqCreated(bytes32 indexed rfqId, address indexed requester, string capability, uint256 maxBudget)",
  "event BidSubmitted(bytes32 indexed rfqId, bytes32 indexed bidId, address indexed provider, uint256 price)",
  "event BidAwarded(bytes32 indexed rfqId, bytes32 indexed bidId, address indexed provider)",
];

export const ARBITRATION_REGISTRY_ABI = [
  "function fileDispute(bytes32 _taskId, address _payee, string _reason) external",
  "function submitEvidence(bytes32 _taskId, string _evidence) external",
  "function resolve(bytes32 _taskId, uint8 _ruling, string _rulingReason) external",
  "function getDispute(bytes32 _taskId) external view returns (tuple(bytes32 taskId, address payer, address payee, string reason, string evidence, uint8 ruling, address arbitrator, string rulingReason, uint256 filedAt, uint256 resolvedAt))",
  "function disputeCount() external view returns (uint256)",
  "function addArbitrator(address _arbitrator) external",
  "function removeArbitrator(address _arbitrator) external",
  "function arbitrators(address) external view returns (bool)",
  "event DisputeFiled(bytes32 indexed taskId, address indexed payer, address indexed payee, string reason)",
  "event EvidenceSubmitted(bytes32 indexed taskId, address indexed payee, string evidence)",
  "event DisputeResolved(bytes32 indexed taskId, uint8 ruling, address arbitrator)",
];

export const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
];
