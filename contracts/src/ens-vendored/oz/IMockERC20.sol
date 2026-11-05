// SPDX-License-Identifier: MIT
pragma solidity >=0.8.13;

import {IERC20} from "./IERC20.sol";

/// @dev Sepolia ENSv2 MockUSDC/MockDAI expose a public mint (contracts-v2 test/mocks/MockERC20.sol).
interface IMockERC20 is IERC20 {
    function mint(address to, uint256 amount) external;
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}
