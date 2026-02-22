// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Test-only USDC token with a public mint function.
 *         Mirrors real USDC's 6-decimal precision.
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * @notice Anyone can mint test tokens. NOT for production.
     */
    function mint(address _to, uint256 _amount) external {
        _mint(_to, _amount);
    }
}
