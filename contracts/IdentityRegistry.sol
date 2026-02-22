// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IdentityRegistry (ERC-8004 Compliant)
 * @notice On-chain agent identity and capability discovery.
 *         Each AI agent registers with metadata (name, endpoint, capabilities)
 *         and a DID-style identifier. Other agents query this to discover peers.
 */
contract IdentityRegistry {
    // ──────────────────────────────── Types ────────────────────────────────

    struct AgentIdentity {
        address wallet;           // Agent's on-chain address
        string  name;             // Human-readable name
        string  did;              // Decentralized identifier (did:erc8004:<addr>)
        string  endpoint;         // Off-chain API endpoint (e.g. http://host:port)
        string[] capabilities;    // List of capability tags (e.g. "oracle", "analysis")
        uint256 registeredAt;
        bool    active;
    }

    // ──────────────────────────────── State ────────────────────────────────

    mapping(address => AgentIdentity) public agents;
    address[] public agentList;
    mapping(address => bool) private _inAgentList;

    // ──────────────────────────────── Events ───────────────────────────────

    event AgentRegistered(address indexed wallet, string did, string name);
    event AgentUpdated(address indexed wallet, string endpoint);
    event AgentCapabilitiesUpdated(address indexed wallet);
    event AgentDeactivated(address indexed wallet);

    // ──────────────────────────────── Modifiers ────────────────────────────

    modifier onlyRegistered() {
        require(agents[msg.sender].active, "Not a registered agent");
        _;
    }

    // ──────────────────────────────── Write ────────────────────────────────

    /**
     * @notice Register a new agent identity on-chain.
     *         If the agent was previously deactivated, re-registration is allowed
     *         without creating a duplicate entry in agentList.
     * @param _name         Human-readable agent name
     * @param _endpoint     HTTP endpoint where the agent listens
     * @param _capabilities Array of capability tags for discovery
     */
    function registerAgent(
        string calldata _name,
        string calldata _endpoint,
        string[] memory _capabilities
    ) external {
        require(!agents[msg.sender].active, "Already registered");

        string memory did = string(
            abi.encodePacked("did:erc8004:", _toHexString(msg.sender))
        );

        agents[msg.sender] = AgentIdentity({
            wallet: msg.sender,
            name: _name,
            did: did,
            endpoint: _endpoint,
            capabilities: _capabilities,
            registeredAt: block.timestamp,
            active: true
        });

        // Only push to agentList if this address has never been registered before
        if (!_inAgentList[msg.sender]) {
            agentList.push(msg.sender);
            _inAgentList[msg.sender] = true;
        }

        emit AgentRegistered(msg.sender, did, _name);
    }

    /**
     * @notice Update the off-chain endpoint for this agent.
     */
    function updateEndpoint(string calldata _endpoint) external onlyRegistered {
        agents[msg.sender].endpoint = _endpoint;
        emit AgentUpdated(msg.sender, _endpoint);
    }

    /**
     * @notice Update the capabilities for this agent.
     * @param _capabilities New array of capability tags
     */
    function updateCapabilities(string[] memory _capabilities) external onlyRegistered {
        agents[msg.sender].capabilities = _capabilities;
        emit AgentCapabilitiesUpdated(msg.sender);
    }

    /**
     * @notice Deactivate this agent (soft delete).
     */
    function deactivate() external onlyRegistered {
        agents[msg.sender].active = false;
        emit AgentDeactivated(msg.sender);
    }

    // ──────────────────────────────── Read ─────────────────────────────────

    /**
     * @notice Look up a specific agent by wallet address.
     */
    function getAgent(address _wallet)
        external
        view
        returns (AgentIdentity memory)
    {
        return agents[_wallet];
    }

    /**
     * @notice Find agents that advertise a specific capability.
     * @param _capability The tag to search for (e.g. "oracle")
     * @param _offset     Start index for pagination (0-based)
     * @param _limit      Maximum results to return (0 = all)
     * @return result Array of matching agent identities
     */
    function findByCapability(
        string calldata _capability,
        uint256 _offset,
        uint256 _limit
    )
        external
        view
        returns (AgentIdentity[] memory result)
    {
        // First pass: collect matching indices
        uint256 totalLen = agentList.length;
        uint256 matchCount;
        uint256[] memory matchIndices = new uint256[](totalLen);

        for (uint256 i = 0; i < totalLen; i++) {
            AgentIdentity storage agent = agents[agentList[i]];
            if (!agent.active) continue;
            for (uint256 j = 0; j < agent.capabilities.length; j++) {
                if (_strEq(agent.capabilities[j], _capability)) {
                    matchIndices[matchCount++] = i;
                    break;
                }
            }
        }

        // Apply pagination
        if (_offset >= matchCount) {
            return new AgentIdentity[](0);
        }
        uint256 remaining = matchCount - _offset;
        uint256 resultLen = (_limit == 0 || _limit > remaining) ? remaining : _limit;

        result = new AgentIdentity[](resultLen);
        for (uint256 k = 0; k < resultLen; k++) {
            result[k] = agents[agentList[matchIndices[_offset + k]]];
        }
    }

    /**
     * @notice Convenience: find all agents by capability (no pagination).
     */
    function findByCapability(string calldata _capability)
        external
        view
        returns (AgentIdentity[] memory result)
    {
        // Two-pass: count matches, then allocate and fill
        uint256 count;
        for (uint256 i = 0; i < agentList.length; i++) {
            AgentIdentity storage agent = agents[agentList[i]];
            if (!agent.active) continue;
            for (uint256 j = 0; j < agent.capabilities.length; j++) {
                if (_strEq(agent.capabilities[j], _capability)) {
                    count++;
                    break;
                }
            }
        }

        result = new AgentIdentity[](count);
        uint256 idx;
        for (uint256 i = 0; i < agentList.length; i++) {
            AgentIdentity storage agent = agents[agentList[i]];
            if (!agent.active) continue;
            for (uint256 j = 0; j < agent.capabilities.length; j++) {
                if (_strEq(agent.capabilities[j], _capability)) {
                    result[idx++] = agent;
                    break;
                }
            }
        }
    }

    /**
     * @notice Return total registered agent count (including deactivated).
     */
    function agentCount() external view returns (uint256) {
        return agentList.length;
    }

    // ──────────────────────────────── Internal ─────────────────────────────

    function _strEq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function _toHexString(address _addr) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes20 value = bytes20(_addr);
        bytes memory str = new bytes(42);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            str[2 + i * 2] = alphabet[uint8(value[i] >> 4)];
            str[3 + i * 2] = alphabet[uint8(value[i] & 0x0f)];
        }
        return string(str);
    }
}
