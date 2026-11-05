// SPDX-License-Identifier: MIT
pragma solidity >=0.8.13;

/// @dev Minimal Universal Resolver surface used by the spike.
/// Source: contracts-v2 `AbstractNormalizedUniversalResolver.resolve`
///   https://github.com/ensdomains/contracts-v2/blob/sepolia-deployment-2026-09-15/contracts/src/universalResolver/AbstractNormalizedUniversalResolver.sol
interface IUniversalResolver {
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory result, address resolver);

    function isENSv2() external view returns (bool);
}
