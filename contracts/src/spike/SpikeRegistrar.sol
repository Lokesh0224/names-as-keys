// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IPermissionedRegistry} from "../ens-vendored/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "../ens-vendored/registry/interfaces/IRegistry.sol";
import {LibLabel} from "../ens-vendored/utils/LibLabel.sol";

/// @notice Throwaway registrar used only for the Stage 0 ENSv2 spike.
///         Granted ROLE_REGISTRAR | ROLE_UNREGISTER on a UserRegistry ROOT_RESOURCE.
contract SpikeRegistrar {
    IPermissionedRegistry public immutable subregistry;
    address public immutable resolver;
    IPermissionedRegistry public immutable parentRegistry;
    address public immutable parentOwner;
    string public parentLabel;

    uint64 public constant MIN_GUEST_DURATION = 60 seconds;
    uint64 public constant MAX_GUEST_DURATION = 30 days;

    constructor(
        IPermissionedRegistry subregistry_,
        address resolver_,
        IPermissionedRegistry parentRegistry_,
        string memory parentLabel_,
        address parentOwner_
    ) {
        subregistry = subregistry_;
        resolver = resolver_;
        parentRegistry = parentRegistry_;
        parentLabel = parentLabel_;
        parentOwner = parentOwner_;
    }

    function register(
        string calldata label,
        address owner,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId) {
        _validateLabel(label);
        require(expiry >= block.timestamp + MIN_GUEST_DURATION, "expiry below 60s");
        require(expiry <= block.timestamp + MAX_GUEST_DURATION, "expiry above 30d");
        require(expiry <= parentRegistry.getExpiry(LibLabel.id(parentLabel)), "expiry exceeds parent");
        tokenId = subregistry.register(
            label, owner, IRegistry(address(0)), resolver, roleBitmap, expiry
        );
    }

    function unregister(uint256 anyId) external {
        subregistry.unregister(anyId);
    }

    /// @notice Q4: guest owns label AND status is REGISTERED AND expiry > now.
    function canUnlock(string calldata label, address caller) external view returns (bool) {
        uint256 labelId = LibLabel.id(label);
        IPermissionedRegistry.State memory state = subregistry.getState(labelId);
        if (state.status != IPermissionedRegistry.Status.REGISTERED) return false;
        if (state.expiry <= uint64(block.timestamp)) return false;
        if (subregistry.getOwner(labelId) != caller) return false;
        return true;
    }

    /// @notice Parent-aware authorization check for the door integration.
    /// @dev `caller` is the guest; `parentOwner` is the configured DoorKeys owner.
    function canUnlockV2(string calldata label, address caller) external view returns (bool) {
        uint256 parentId = LibLabel.id(parentLabel);
        IPermissionedRegistry.State memory parent = parentRegistry.getState(parentId);
        if (parent.status != IPermissionedRegistry.Status.REGISTERED) return false;
        if (parent.expiry <= block.timestamp) return false;
        if (parentRegistry.getOwner(parentId) != parentOwner) return false;
        if (address(parentRegistry.getSubregistry(parentLabel)) != address(subregistry)) return false;

        uint256 childId = LibLabel.id(label);
        IPermissionedRegistry.State memory child = subregistry.getState(childId);
        if (child.status != IPermissionedRegistry.Status.REGISTERED) return false;
        if (child.expiry <= block.timestamp || child.expiry > parent.expiry) return false;
        if (subregistry.getOwner(childId) != caller) return false;
        return true;
    }

    function _validateLabel(string calldata label) private pure {
        bytes calldata value = bytes(label);
        require(value.length >= 3 && value.length <= 32, "label length");
        require(value[0] != bytes1("-") && value[value.length - 1] != bytes1("-"), "label hyphen");
        for (uint256 i; i < value.length; ++i) {
            bytes1 c = value[i];
            require((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d, "label charset");
        }
    }
}
