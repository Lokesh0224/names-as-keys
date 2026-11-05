// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IRegistry} from "./ens-vendored/registry/interfaces/IRegistry.sol";
import {IPermissionedRegistry} from "./ens-vendored/registry/interfaces/IPermissionedRegistry.sol";
import {IVerifiableFactory} from "./ens-vendored/verifiable-factory/IVerifiableFactory.sol";
import {LibLabel} from "./ens-vendored/utils/LibLabel.sol";

/// @notice Owner-restricted issuer for one Sepolia ENSv2 door's guest registry.
/// @dev ENS state is authoritative. Registry administrators remain trusted and can revoke this
///      contract's permissions. No renewal, role forwarding or guest authorization list exists.
contract CredentialRegistrar {
    IPermissionedRegistry public constant ETH_REGISTRY =
        IPermissionedRegistry(0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4);
    IRegistry public constant ROOT_REGISTRY = IRegistry(0xB458D6a3a77919449d03e7A6903C26827c1eC43f);
    IVerifiableFactory public constant FACTORY = IVerifiableFactory(0xDa70306C98E97eCe36F997a21368e53298572991);
    address public constant USER_REGISTRY_IMPL = 0x9BD8a88719068D09ecee662f36C0E3856708366a;
    uint256 public constant SEPOLIA_CHAIN_ID = 11155111;
    uint256 public constant REGISTRAR_ROLE = 1;
    uint256 public constant UNREGISTER_ROLE = 4096;
    uint256 public constant ISSUE_ROLES = REGISTRAR_ROLE | UNREGISTER_ROLE;
    uint64 public constant MIN_DURATION = 60;
    uint64 public constant MAX_DURATION = 30 days;

    address public immutable owner;
    IPermissionedRegistry public immutable parentRegistry;
    IPermissionedRegistry public immutable guestRegistry;
    uint256 public immutable rootTokenId;
    uint256 public immutable lockTokenId;
    string public rootLabel;
    bool private entered;

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidHierarchy();
    error InvalidPermissions();
    error InvalidGuest();
    error InvalidLabel();
    error InvalidExpiry();
    error LabelAlreadyUsed();
    error StaleCredential();
    error ReentrantCall();
    error RegistryPostconditionFailed();

    event CredentialIssued(bytes32 indexed labelHash, uint256 indexed tokenId, address indexed guest, uint64 expiry);
    event CredentialRevoked(bytes32 indexed labelHash, uint256 indexed tokenId);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (entered) revert ReentrantCall();
        entered = true;
        _;
        entered = false;
    }

    constructor(
        address owner_,
        string memory rootLabel_,
        IPermissionedRegistry parent_,
        IPermissionedRegistry guests_
    ) {
        if (
            block.chainid != SEPOLIA_CHAIN_ID || owner_ == address(0) || address(parent_) == address(guests_)
                || address(parent_).code.length == 0 || address(guests_).code.length == 0
        ) revert InvalidConfiguration();
        _validateLabel(rootLabel_);
        owner = owner_;
        rootLabel = rootLabel_;
        parentRegistry = parent_;
        guestRegistry = guests_;
        rootTokenId = ETH_REGISTRY.getState(LibLabel.id(rootLabel_)).tokenId;
        lockTokenId = parent_.getState(LibLabel.id("lock")).tokenId;
        _requireHierarchy();
    }

    /// @notice Create a guest label with no recorded use in the current registry state.
    /// @dev Calls into registry getters fail closed by propagating reverts.
    function issue(string calldata label, address guest, uint64 expiry)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokenId)
    {
        _validateLabel(label);
        uint64 ancestorExpiry = _requireHierarchy();
        if (
            guest == address(0) || guest == owner || guest == address(this)
                || guestRegistry.roles(guestRegistry.ROOT_RESOURCE(), guest) != 0
        ) revert InvalidGuest();
        if (
            guestRegistry.roles(guestRegistry.ROOT_RESOURCE(), address(this)) != ISSUE_ROLES
                || guestRegistry.isEmancipated()
        ) revert InvalidPermissions();
        if (
            uint256(expiry) < block.timestamp + MIN_DURATION || uint256(expiry) > block.timestamp + MAX_DURATION
                || expiry > ancestorExpiry
        ) revert InvalidExpiry();
        uint256 labelId = LibLabel.id(label);
        // Require the complete initial state, not expiry alone. This is a current-state
        // policy for this implementation, not permanent history across registry/admin changes.
        IPermissionedRegistry.State memory prior = guestRegistry.getState(labelId);
        if (
            prior.status != IPermissionedRegistry.Status.AVAILABLE || prior.expiry != 0
                || prior.latestOwner != address(0) || prior.tokenId != LibLabel.withVersion(labelId, 0)
                || prior.resource != LibLabel.withVersion(labelId, 1)
        ) revert LabelAlreadyUsed();
        tokenId = guestRegistry.register(label, guest, IRegistry(address(0)), address(0), 0, expiry);
        IPermissionedRegistry.State memory state = guestRegistry.getState(labelId);
        if (
            state.status != IPermissionedRegistry.Status.REGISTERED || state.tokenId != tokenId
                || state.expiry != expiry || guestRegistry.getOwner(labelId) != guest
                || guestRegistry.roles(state.resource, guest) != 0
                || address(guestRegistry.getSubregistry(label)) != address(0)
                || guestRegistry.getResolver(label) != address(0)
        ) revert RegistryPostconditionFailed();
        // A smart-contract receiver callback cannot silently alter the parent path during issuance.
        _requireHierarchy();
        if (
            guestRegistry.roles(guestRegistry.ROOT_RESOURCE(), address(this)) != ISSUE_ROLES
                || guestRegistry.roles(guestRegistry.ROOT_RESOURCE(), guest) != 0 || guestRegistry.isEmancipated()
        ) revert RegistryPostconditionFailed();
        emit CredentialIssued(bytes32(labelId), tokenId, guest, expiry);
    }

    /// @notice Revoke a currently active credential in the fixed R2, including after detachment.
    /// @param expectedTokenId Current ENS token ID, preventing stale requests from revoking a new generation.
    function revoke(string calldata label, uint256 expectedTokenId) external onlyOwner nonReentrant {
        _validateLabel(label);
        _verifyImplementation(guestRegistry);
        uint256 labelId = LibLabel.id(label);
        IPermissionedRegistry.State memory state = guestRegistry.getState(labelId);
        if (
            state.status != IPermissionedRegistry.Status.REGISTERED || state.tokenId != expectedTokenId
                || state.expiry <= block.timestamp
        ) revert StaleCredential();
        // Losing REGISTRAR does not disable emergency revocation while UNREGISTER remains.
        if (!guestRegistry.hasRootRoles(UNREGISTER_ROLE, address(this))) revert InvalidPermissions();
        guestRegistry.unregister(labelId);
        if (
            guestRegistry.getState(labelId).status == IPermissionedRegistry.Status.REGISTERED
                || guestRegistry.getOwner(labelId) != address(0)
        ) revert RegistryPostconditionFailed();
        emit CredentialRevoked(bytes32(labelId), expectedTokenId);
    }

    function _requireHierarchy() private view returns (uint64) {
        if (block.chainid != SEPOLIA_CHAIN_ID || address(ROOT_REGISTRY.getSubregistry("eth")) != address(ETH_REGISTRY))
        {
            revert InvalidHierarchy();
        }
        _verifyImplementation(parentRegistry);
        _verifyImplementation(guestRegistry);
        IPermissionedRegistry.State memory root = ETH_REGISTRY.getState(LibLabel.id(rootLabel));
        IPermissionedRegistry.State memory lock = parentRegistry.getState(LibLabel.id("lock"));
        if (
            root.status != IPermissionedRegistry.Status.REGISTERED
                || lock.status != IPermissionedRegistry.Status.REGISTERED || root.expiry <= block.timestamp
                || lock.expiry <= block.timestamp || lock.expiry > root.expiry || root.tokenId != rootTokenId
                || lock.tokenId != lockTokenId || ETH_REGISTRY.getOwner(LibLabel.id(rootLabel)) != owner
                || parentRegistry.getOwner(LibLabel.id("lock")) != owner
                || address(ETH_REGISTRY.getSubregistry(rootLabel)) != address(parentRegistry)
                || address(parentRegistry.getSubregistry("lock")) != address(guestRegistry)
        ) revert InvalidHierarchy();
        return lock.expiry;
    }

    function _verifyImplementation(IPermissionedRegistry registry) private view {
        if (FACTORY.verifyContract(address(registry)) != USER_REGISTRY_IMPL) revert InvalidConfiguration();
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
