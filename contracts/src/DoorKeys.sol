// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IRegistry} from "./ens-vendored/registry/interfaces/IRegistry.sol";
import {IPermissionedRegistry} from "./ens-vendored/registry/interfaces/IPermissionedRegistry.sol";
import {IVerifiableFactory} from "./ens-vendored/verifiable-factory/IVerifiableFactory.sol";
import {LibLabel} from "./ens-vendored/utils/LibLabel.sol";

/// @notice Door-specific unlock requests authorized exclusively by current Sepolia ENSv2 state.
/// @dev Trusted administrators may renew/reissue names. No guest list or historical denylist.
contract DoorKeys {
    IPermissionedRegistry public constant ETH_REGISTRY =
        IPermissionedRegistry(0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4);
    IRegistry public constant ROOT_REGISTRY = IRegistry(0xB458D6a3a77919449d03e7A6903C26827c1eC43f);
    IVerifiableFactory public constant FACTORY = IVerifiableFactory(0xDa70306C98E97eCe36F997a21368e53298572991);
    address public constant USER_REGISTRY_IMPL = 0x9BD8a88719068D09ecee662f36C0E3856708366a;
    uint256 public constant SEPOLIA_CHAIN_ID = 11155111;
    bytes32 public constant LOCK_LABEL_HASH = keccak256("lock");

    address public immutable administrator;
    IPermissionedRegistry public immutable parentRegistry;
    IPermissionedRegistry public immutable guestRegistry;
    bytes32 public immutable rootLabelHash;
    uint256 public immutable rootTokenId;
    uint256 public immutable lockTokenId;
    uint256 public immutable deploymentEpoch;
    bytes32 public immutable doorId;
    string public rootLabel;
    uint256 public requestNonce;

    error InvalidConfiguration();
    error InvalidHierarchy();
    error InvalidCredential();
    error InvalidLabel();

    event DoorUnlocked(
        bytes32 indexed doorId,
        address indexed guest,
        bytes32 indexed credentialLabelHash,
        uint256 credentialTokenId,
        uint64 credentialExpiry,
        uint256 requestNonce
    );

    constructor(
        address administrator_,
        string memory rootLabel_,
        IPermissionedRegistry parent_,
        IPermissionedRegistry guests_,
        uint256 deploymentEpoch_
    ) {
        if (
            block.chainid != SEPOLIA_CHAIN_ID || administrator_ == address(0) || address(parent_) == address(guests_)
                || address(parent_).code.length == 0 || address(guests_).code.length == 0
        ) revert InvalidConfiguration();
        _validateLabel(rootLabel_);
        administrator = administrator_;
        rootLabel = rootLabel_;
        rootLabelHash = keccak256(bytes(rootLabel_));
        parentRegistry = parent_;
        guestRegistry = guests_;
        rootTokenId = ETH_REGISTRY.getState(uint256(rootLabelHash)).tokenId;
        lockTokenId = parent_.getState(uint256(LOCK_LABEL_HASH)).tokenId;
        deploymentEpoch = deploymentEpoch_;
        _requireHierarchy();
        doorId = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                rootLabelHash,
                LOCK_LABEL_HASH,
                parent_,
                guests_,
                rootTokenId,
                lockTokenId,
                deploymentEpoch_
            )
        );
    }

    /// @notice Emit an unlock request only for the credential's actual current ENS owner.
    /// @dev All external calls are view/STATICCALL. No token transfer, receiver hook or Ether send.
    function unlock(string calldata label) external {
        _validateLabel(label);
        uint64 ancestorExpiry = _requireHierarchy();
        uint256 labelId = LibLabel.id(label);
        IPermissionedRegistry.State memory credential = guestRegistry.getState(labelId);
        if (
            credential.status != IPermissionedRegistry.Status.REGISTERED || credential.expiry <= block.timestamp
                || credential.expiry > ancestorExpiry || guestRegistry.getOwner(labelId) != msg.sender
                || guestRegistry.roleCount(credential.resource) != 0
                || guestRegistry.roles(guestRegistry.ROOT_RESOURCE(), msg.sender) != 0 || guestRegistry.isEmancipated()
        ) revert InvalidCredential();
        uint256 nonce = ++requestNonce;
        emit DoorUnlocked(doorId, msg.sender, bytes32(labelId), credential.tokenId, credential.expiry, nonce);
    }

    function _requireHierarchy() private view returns (uint64) {
        if (block.chainid != SEPOLIA_CHAIN_ID || address(ROOT_REGISTRY.getSubregistry("eth")) != address(ETH_REGISTRY))
        {
            revert InvalidHierarchy();
        }
        if (
            FACTORY.verifyContract(address(parentRegistry)) != USER_REGISTRY_IMPL
                || FACTORY.verifyContract(address(guestRegistry)) != USER_REGISTRY_IMPL
        ) revert InvalidConfiguration();
        IPermissionedRegistry.State memory root = ETH_REGISTRY.getState(uint256(rootLabelHash));
        IPermissionedRegistry.State memory lock = parentRegistry.getState(uint256(LOCK_LABEL_HASH));
        if (
            root.status != IPermissionedRegistry.Status.REGISTERED
                || lock.status != IPermissionedRegistry.Status.REGISTERED || root.expiry <= block.timestamp
                || lock.expiry <= block.timestamp || lock.expiry > root.expiry || root.tokenId != rootTokenId
                || lock.tokenId != lockTokenId || ETH_REGISTRY.getOwner(uint256(rootLabelHash)) != administrator
                || parentRegistry.getOwner(uint256(LOCK_LABEL_HASH)) != administrator
                || address(ETH_REGISTRY.getSubregistry(rootLabel)) != address(parentRegistry)
                || address(parentRegistry.getSubregistry("lock")) != address(guestRegistry)
        ) revert InvalidHierarchy();
        return lock.expiry;
    }

    function _validateLabel(string memory label) private pure {
        bytes memory value = bytes(label);
        if (value.length < 3 || value.length > 32 || value[0] == "-" || value[value.length - 1] == "-") {
            revert InvalidLabel();
        }
        for (uint256 i; i < value.length; ++i) {
            bytes1 c = value[i];
            if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d)) revert InvalidLabel();
        }
    }
}
