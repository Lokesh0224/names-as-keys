// SPDX-License-Identifier: MIT
pragma solidity >=0.8.13;

/// @dev Subset of PublicResolverV2 used by the spike.
/// Source: contracts-v2 PublicResolverV2.sol (sepolia-deployment-2026-09-15)
interface IPublicResolverV2 {
    function setAddr(bytes32 node, address a) external;
    function addr(bytes32 node) external view returns (address);
    function canModifyName(bytes32 node, address operator) external view returns (bool);
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
