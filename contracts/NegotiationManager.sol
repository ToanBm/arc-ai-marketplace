// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NegotiationManager
 * @notice On-chain bid/ask negotiation between AI agents.
 *
 *         Flow:
 *         1. Agent A creates a Request For Quote (RFQ) describing what they need
 *         2. Providers (B, C, ...) submit bids with pricing and terms
 *         3. Agent A selects the best bid
 *         4. The winning bid is recorded on-chain for transparency
 *
 *         This enables competitive pricing in the agent marketplace.
 */
contract NegotiationManager {
    // ──────────────────────────────── Types ────────────────────────────────

    enum RfqStatus { Open, Awarded, Cancelled }
    enum BidStatus { Active, Won, Lost, Withdrawn }

    struct Rfq {
        bytes32    rfqId;
        address    requester;      // Agent A
        string     capability;     // e.g. "oracle"
        string     description;    // e.g. "ETH/USD price + trend analysis"
        uint256    maxBudget;      // Max USDC the requester will pay (6 decimals)
        uint256    deadline;       // Bidding deadline (timestamp)
        RfqStatus  status;
        bytes32    winningBidId;
        uint256    createdAt;
        uint256    bidCount;
    }

    struct Bid {
        bytes32    bidId;
        bytes32    rfqId;
        address    provider;       // Agent B/C
        uint256    price;          // USDC price offered (6 decimals)
        uint256    estimatedTime;  // Estimated delivery in seconds
        string     terms;          // Free-text terms/conditions
        BidStatus  status;
        uint256    submittedAt;
    }

    // ──────────────────────────────── State ────────────────────────────────

    mapping(bytes32 => Rfq) public rfqs;
    mapping(bytes32 => Bid) public bids;
    mapping(bytes32 => bytes32[]) public rfqBids; // rfqId → bidIds
    bytes32[] public rfqIds;

    // ──────────────────────────────── Events ───────────────────────────────

    event RfqCreated(bytes32 indexed rfqId, address indexed requester, string capability, uint256 maxBudget);
    event BidSubmitted(bytes32 indexed rfqId, bytes32 indexed bidId, address indexed provider, uint256 price);
    event BidAwarded(bytes32 indexed rfqId, bytes32 indexed bidId, address indexed provider);
    event RfqCancelled(bytes32 indexed rfqId);
    event BidWithdrawn(bytes32 indexed rfqId, bytes32 indexed bidId);

    // ──────────────────────────────── Write ────────────────────────────────

    /**
     * @notice Create a Request For Quote.
     * @param _rfqId       Unique identifier
     * @param _capability  Capability tag providers must match
     * @param _description Human-readable task description
     * @param _maxBudget   Maximum USDC to pay (6 decimals)
     * @param _biddingTime Seconds the bidding window is open
     */
    function createRfq(
        bytes32 _rfqId,
        string calldata _capability,
        string calldata _description,
        uint256 _maxBudget,
        uint256 _biddingTime
    ) external {
        require(rfqs[_rfqId].createdAt == 0, "RFQ already exists");
        require(_maxBudget > 0, "Budget must be > 0");
        require(_biddingTime >= 30, "Bidding time too short");

        rfqs[_rfqId] = Rfq({
            rfqId: _rfqId,
            requester: msg.sender,
            capability: _capability,
            description: _description,
            maxBudget: _maxBudget,
            deadline: block.timestamp + _biddingTime,
            status: RfqStatus.Open,
            winningBidId: bytes32(0),
            createdAt: block.timestamp,
            bidCount: 0
        });

        rfqIds.push(_rfqId);
        emit RfqCreated(_rfqId, msg.sender, _capability, _maxBudget);
    }

    /**
     * @notice Submit a bid for an open RFQ.
     * @param _rfqId         The RFQ to bid on
     * @param _bidId         Unique bid identifier
     * @param _price         USDC price offered (must be <= maxBudget)
     * @param _estimatedTime Estimated delivery time in seconds
     * @param _terms         Free-text terms/conditions
     */
    function submitBid(
        bytes32 _rfqId,
        bytes32 _bidId,
        uint256 _price,
        uint256 _estimatedTime,
        string calldata _terms
    ) external {
        Rfq storage rfq = rfqs[_rfqId];
        require(rfq.createdAt != 0, "RFQ does not exist");
        require(rfq.status == RfqStatus.Open, "RFQ not open");
        require(block.timestamp <= rfq.deadline, "Bidding closed");
        require(_price <= rfq.maxBudget, "Price exceeds budget");
        require(msg.sender != rfq.requester, "Cannot bid on own RFQ");
        require(bids[_bidId].submittedAt == 0, "Bid ID already used");

        bids[_bidId] = Bid({
            bidId: _bidId,
            rfqId: _rfqId,
            provider: msg.sender,
            price: _price,
            estimatedTime: _estimatedTime,
            terms: _terms,
            status: BidStatus.Active,
            submittedAt: block.timestamp
        });

        rfqBids[_rfqId].push(_bidId);
        rfq.bidCount++;

        emit BidSubmitted(_rfqId, _bidId, msg.sender, _price);
    }

    /**
     * @notice Award an RFQ to a specific bid. Only the requester can call.
     * @param _rfqId  The RFQ being awarded
     * @param _bidId  The winning bid
     */
    function awardBid(bytes32 _rfqId, bytes32 _bidId) external {
        Rfq storage rfq = rfqs[_rfqId];
        require(rfq.requester == msg.sender, "Only requester can award");
        require(rfq.status == RfqStatus.Open, "RFQ not open");

        Bid storage winningBid = bids[_bidId];
        require(winningBid.rfqId == _rfqId, "Bid not for this RFQ");
        require(winningBid.status == BidStatus.Active, "Bid not active");

        rfq.status = RfqStatus.Awarded;
        rfq.winningBidId = _bidId;
        winningBid.status = BidStatus.Won;

        // Mark all other bids as lost
        bytes32[] storage bidList = rfqBids[_rfqId];
        for (uint256 i = 0; i < bidList.length; i++) {
            if (bidList[i] != _bidId && bids[bidList[i]].status == BidStatus.Active) {
                bids[bidList[i]].status = BidStatus.Lost;
            }
        }

        emit BidAwarded(_rfqId, _bidId, winningBid.provider);
    }

    /**
     * @notice Cancel an open RFQ. Only the requester can cancel.
     */
    function cancelRfq(bytes32 _rfqId) external {
        Rfq storage rfq = rfqs[_rfqId];
        require(rfq.requester == msg.sender, "Only requester can cancel");
        require(rfq.status == RfqStatus.Open, "RFQ not open");

        rfq.status = RfqStatus.Cancelled;
        emit RfqCancelled(_rfqId);
    }

    /**
     * @notice Withdraw a bid. Only the bid provider can withdraw.
     */
    function withdrawBid(bytes32 _bidId) external {
        Bid storage b = bids[_bidId];
        require(b.provider == msg.sender, "Only provider can withdraw");
        require(b.status == BidStatus.Active, "Bid not active");

        b.status = BidStatus.Withdrawn;
        emit BidWithdrawn(b.rfqId, _bidId);
    }

    // ──────────────────────────────── Read ─────────────────────────────────

    function getRfq(bytes32 _rfqId) external view returns (Rfq memory) {
        return rfqs[_rfqId];
    }

    function getBid(bytes32 _bidId) external view returns (Bid memory) {
        return bids[_bidId];
    }

    function getBidsForRfq(bytes32 _rfqId) external view returns (Bid[] memory) {
        bytes32[] storage bidList = rfqBids[_rfqId];
        Bid[] memory result = new Bid[](bidList.length);
        for (uint256 i = 0; i < bidList.length; i++) {
            result[i] = bids[bidList[i]];
        }
        return result;
    }

    function rfqCount() external view returns (uint256) {
        return rfqIds.length;
    }
}
