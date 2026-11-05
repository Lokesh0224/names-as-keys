// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IRegistry} from "../../src/ens-vendored/registry/interfaces/IRegistry.sol";
import {IPermissionedRegistry} from "../../src/ens-vendored/registry/interfaces/IPermissionedRegistry.sol";
import {IETHRegistrar} from "../../src/ens-vendored/registrar/interfaces/IETHRegistrar.sol";
import {IVerifiableFactory} from "../../src/ens-vendored/verifiable-factory/IVerifiableFactory.sol";
import {Grant} from "../../src/ens-vendored/access-control/interfaces/IEACGrantInitializable.sol";
import {RegistryRolesLib as R} from "../../src/ens-vendored/registry/libraries/RegistryRolesLib.sol";
import {LibLabel} from "../../src/ens-vendored/utils/LibLabel.sol";
import {IMockERC20} from "../../src/ens-vendored/oz/IMockERC20.sol";
import {IERC20} from "../../src/ens-vendored/oz/IERC20.sol";

interface IRegistrarTiming {
    function MIN_COMMITMENT_AGE() external view returns (uint64);
}

/// @notice Fork-only experiment. No production registrar, DoorKeys, signer or guest list.
/// @dev Run with an externally selected Sepolia fork, pinned to block 12071220.
contract ThreeLevelENSv2Test is Test {
    IPermissionedRegistry constant ETH = IPermissionedRegistry(0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4);
    IRegistry constant ROOT = IRegistry(0xB458D6a3a77919449d03e7A6903C26827c1eC43f);
    IETHRegistrar constant REGISTRAR = IETHRegistrar(0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3);
    IVerifiableFactory constant FACTORY = IVerifiableFactory(0xDa70306C98E97eCe36F997a21368e53298572991);
    address constant IMPL = 0x9BD8a88719068D09ecee662f36C0E3856708366a;
    IMockERC20 constant USDC = IMockERC20(0x240b0316Df57887DBBE58b586508b19e633a14aa);
    address constant OWNER = address(0xA11CE);
    address constant GUEST = address(0xB0B);
    address constant OTHER = address(0xCAFE);
    address constant OPERATOR = address(0xD00D);
    uint256 constant OPERATIONS =
        R.ROLE_REGISTRAR | R.ROLE_UNREGISTER | R.ROLE_RENEW | R.ROLE_SET_SUBREGISTRY | R.ROLE_SET_PARENT;
    uint256 constant ADMINS = OPERATIONS << 128;
    string internal rootLabel;
    IPermissionedRegistry internal r1;
    IPermissionedRegistry internal r2;
    uint256 internal rootToken;
    uint256 internal lockToken;
    uint256 internal miraToken;
    uint64 internal rootExpiry;
    uint64 internal lockExpiry;
    uint64 internal miraExpiry;
    uint256 internal salt;
    bytes32 internal door;

    function setUp() public {
        assertEq(block.chainid, 11155111, "requires Sepolia fork");
        // Isolated synthetic root, deliberately different from the approved live root.
        rootLabel = string.concat("nak3b-fixture-", vm.toString(block.number));
        assertTrue(REGISTRAR.isAvailable(rootLabel), "synthetic root collision");
        rootToken = _registerRoot(OWNER);
        rootExpiry = ETH.getExpiry(rootToken);
        r1 = _registry();
        vm.prank(OWNER);
        ETH.setSubregistry(rootToken, r1);
        vm.prank(OWNER);
        r1.setParent(ETH, rootLabel);
        lockExpiry = uint64(block.timestamp + 90 days);
        vm.prank(OWNER);
        lockToken = r1.register(
            "lock",
            OWNER,
            IRegistry(address(0)),
            address(0),
            R.ROLE_SET_SUBREGISTRY | R.ROLE_SET_SUBREGISTRY_ADMIN | R.ROLE_CAN_TRANSFER_ADMIN,
            lockExpiry
        );
        r2 = _registry();
        vm.prank(OWNER);
        r1.setSubregistry(lockToken, r2);
        vm.prank(OWNER);
        r2.setParent(r1, "lock");
        miraExpiry = uint64(block.timestamp + 1 days);
        vm.prank(OWNER);
        miraToken = r2.register("mira", GUEST, IRegistry(address(0)), address(0), 0, miraExpiry);
        door = keccak256(abi.encode(block.chainid, address(this), rootLabel, "lock", r1, r2, uint256(1)));
    }

    function _registerRoot(address recipient) internal returns (uint256) {
        bytes32 secret = keccak256(abi.encode("FORK TEST ONLY", recipient, block.timestamp));
        bytes32 commitment = REGISTRAR.makeCommitment(
            rootLabel, recipient, secret, IRegistry(address(0)), address(0), 365 days, bytes32(0)
        );
        REGISTRAR.commit(commitment);
        vm.warp(block.timestamp + IRegistrarTiming(address(REGISTRAR)).MIN_COMMITMENT_AGE() + 1);
        (uint256 base, uint256 premium) = REGISTRAR.getRegisterPrice(rootLabel, 365 days, IERC20(address(USDC)));
        USDC.mint(address(this), base + premium);
        USDC.approve(address(REGISTRAR), base + premium);
        return REGISTRAR.register(
            rootLabel, recipient, secret, IRegistry(address(0)), address(0), 365 days, IERC20(address(USDC)), bytes32(0)
        );
    }

    function _registry() internal returns (IPermissionedRegistry registry) {
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(OWNER, OPERATIONS | ADMINS);
        address proxy =
            FACTORY.deployProxy(IMPL, ++salt, abi.encodeWithSignature("initialize((address,uint256)[])", grants));
        assertEq(FACTORY.verifyContract(proxy), IMPL);
        registry = IPermissionedRegistry(proxy);
        assertEq(registry.roles(registry.ROOT_RESOURCE(), OWNER), OPERATIONS | ADMINS);
    }

    /// @dev Test oracle only: reads current ENS state, not resolver addresses or guest mappings.
    function _accept(string memory label, address caller, bytes32 requestedDoor) internal view returns (bool) {
        if (caller == address(0) || requestedDoor != door || address(ROOT.getSubregistry("eth")) != address(ETH)) {
            return false;
        }
        IPermissionedRegistry.State memory a = ETH.getState(LibLabel.id(rootLabel));
        IPermissionedRegistry.State memory b = r1.getState(LibLabel.id("lock"));
        IPermissionedRegistry.State memory c = r2.getState(LibLabel.id(label));
        if (
            a.status != IPermissionedRegistry.Status.REGISTERED || b.status != IPermissionedRegistry.Status.REGISTERED
                || c.status != IPermissionedRegistry.Status.REGISTERED
        ) return false;
        if (a.expiry <= block.timestamp || b.expiry <= block.timestamp || c.expiry <= block.timestamp) return false;
        if (c.expiry > b.expiry || b.expiry > a.expiry) return false;
        if (a.tokenId != rootToken || b.tokenId != lockToken) return false;
        if (ETH.getOwner(LibLabel.id(rootLabel)) != OWNER || r1.getOwner(LibLabel.id("lock")) != OWNER) return false;
        if (address(ETH.getSubregistry(rootLabel)) != address(r1) || address(r1.getSubregistry("lock")) != address(r2))
        {
            return false;
        }
        return r2.getOwner(LibLabel.id(label)) == caller;
    }

    function testHierarchyOwnershipExpiryAndBothLinks() public view {
        assertEq(address(ETH.getSubregistry(rootLabel)), address(r1));
        assertEq(address(r1.getSubregistry("lock")), address(r2));
        (IRegistry parent1, string memory label1) = r1.getParent();
        (IRegistry parent2, string memory label2) = r2.getParent();
        assertEq(address(parent1), address(ETH));
        assertEq(label1, rootLabel);
        assertEq(address(parent2), address(r1));
        assertEq(label2, "lock");
        assertEq(ETH.getOwner(rootToken), OWNER);
        assertEq(r1.getOwner(lockToken), OWNER);
        assertEq(r2.getOwner(miraToken), GUEST);
        assertEq(ETH.getExpiry(rootToken), rootExpiry);
        assertEq(r1.getExpiry(lockToken), lockExpiry);
        assertEq(r2.getExpiry(miraToken), miraExpiry);
        assertLe(miraExpiry, lockExpiry);
        assertLe(lockExpiry, rootExpiry);
        assertTrue(_accept("mira", GUEST, door));
        assertFalse(_accept("mira", OTHER, door));
        assertFalse(_accept("missing", GUEST, door));
        assertFalse(_accept("mira", address(0), door));
        assertFalse(_accept("mira", GUEST, keccak256("different door")));
    }

    function testCredentialRevocation() public {
        vm.prank(OWNER);
        r2.unregister(miraToken);
        assertFalse(_accept("mira", GUEST, door));
        assertEq(r2.getOwner(LibLabel.id("mira")), address(0));
    }

    function testCredentialExpiryBoundary() public {
        vm.warp(miraExpiry - 1);
        assertTrue(_accept("mira", GUEST, door));
        vm.warp(miraExpiry);
        assertFalse(_accept("mira", GUEST, door));
    }

    function testAncestorExpiryWithStillLiveDescendants() public {
        // Raw registry permits independent expiries; policy must check ancestors and bounds.
        vm.prank(OWNER);
        r2.renew(miraToken, rootExpiry + 1 days);
        assertFalse(_accept("mira", GUEST, door), "child beyond parent must fail");
        vm.warp(lockExpiry);
        assertFalse(_accept("mira", GUEST, door));
        vm.warp(rootExpiry);
        assertFalse(_accept("mira", GUEST, door));
    }

    function testLockExpiryBoundaryWithAlignedGuest() public {
        vm.prank(OWNER);
        r2.renew(miraToken, lockExpiry);
        vm.warp(lockExpiry - 1);
        assertTrue(_accept("mira", GUEST, door));
        vm.warp(lockExpiry);
        assertFalse(_accept("mira", GUEST, door));
    }

    function testRootExpiryBoundaryWithAlignedDescendants() public {
        vm.prank(OWNER);
        r1.renew(lockToken, rootExpiry);
        vm.prank(OWNER);
        r2.renew(miraToken, rootExpiry);
        vm.warp(rootExpiry - 1);
        assertTrue(_accept("mira", GUEST, door));
        vm.warp(rootExpiry);
        assertFalse(_accept("mira", GUEST, door));
    }

    function testRootOwnerTransferRejectsLiveGuest() public {
        vm.prank(OWNER);
        ETH.unsafeTransfer(OTHER, rootToken, "");
        assertEq(ETH.getOwner(rootToken), OTHER);
        assertFalse(_accept("mira", GUEST, door));
    }

    function testLockOwnerTransferRejectsLiveGuest() public {
        vm.prank(OWNER);
        r1.unsafeTransfer(OTHER, lockToken, "");
        assertEq(r1.getOwner(lockToken), OTHER);
        assertFalse(_accept("mira", GUEST, door));
    }

    function testLockGenerationChangeSameOwnerRejects() public {
        vm.prank(OWNER);
        r1.unregister(lockToken);
        assertFalse(_accept("mira", GUEST, door));
        vm.prank(OWNER);
        uint256 next = r1.register("lock", OWNER, r2, address(0), R.ROLE_SET_SUBREGISTRY, lockExpiry);
        assertTrue(next != lockToken, "generation must change");
        assertEq(r1.getOwner(next), OWNER);
        assertEq(address(r1.getSubregistry("lock")), address(r2));
        assertFalse(_accept("mira", GUEST, door), "old binding must reject new generation");
        lockToken = next;
        assertTrue(_accept("mira", GUEST, door), "test-only explicit rebind restores path");
    }

    function testRootGenerationChangeSameOwnerRejects() public {
        vm.warp(uint256(rootExpiry) + REGISTRAR.GRACE_PERIOD() + 1);
        assertTrue(REGISTRAR.isAvailable(rootLabel));
        uint256 next = _registerRoot(OWNER);
        assertTrue(next != rootToken, "root generation must change");
        vm.startPrank(OWNER);
        ETH.setSubregistry(next, r1);
        lockToken =
            r1.register("lock", OWNER, r2, address(0), R.ROLE_SET_SUBREGISTRY, uint64(block.timestamp + 90 days));
        miraToken = r2.register("mira", GUEST, IRegistry(address(0)), address(0), 0, uint64(block.timestamp + 1 days));
        vm.stopPrank();
        assertFalse(_accept("mira", GUEST, door), "old root binding must reject");
        rootToken = next;
        assertTrue(_accept("mira", GUEST, door), "all current state except binding was valid");
    }

    function testDetachedAndReplacedR1Rejects() public {
        vm.prank(OWNER);
        ETH.setSubregistry(rootToken, IRegistry(address(0)));
        assertFalse(_accept("mira", GUEST, door));
        IPermissionedRegistry replacement = _registry();
        vm.prank(OWNER);
        ETH.setSubregistry(rootToken, replacement);
        assertFalse(_accept("mira", GUEST, door));
        assertEq(r2.getOwner(miraToken), GUEST, "stale credential still exists");
    }

    function testDetachedAndReplacedR2Rejects() public {
        vm.prank(OWNER);
        r1.setSubregistry(lockToken, IRegistry(address(0)));
        assertFalse(_accept("mira", GUEST, door));
        IPermissionedRegistry replacement = _registry();
        vm.prank(OWNER);
        r1.setSubregistry(lockToken, replacement);
        assertFalse(_accept("mira", GUEST, door));
        assertEq(r2.getOwner(miraToken), GUEST);
    }

    function testCanonicalParentMetadataDoesNotAttachRegistry() public {
        IPermissionedRegistry replacement = _registry();
        vm.prank(OWNER);
        replacement.setParent(r1, "lock");
        assertEq(address(r1.getSubregistry("lock")), address(r2));
        assertTrue(_accept("mira", GUEST, door));
    }

    function testRoleRequirementsAndRevocation() public {
        assertTrue(ETH.hasRoles(ETH.getResource(rootToken), R.ROLE_SET_SUBREGISTRY, OWNER));
        assertTrue(r1.hasRootRoles(OPERATIONS | ADMINS, OWNER));
        assertEq(r2.roles(r2.getResource(miraToken), GUEST), 0);
        vm.startPrank(OTHER);
        vm.expectRevert();
        r2.register("intruder", OTHER, IRegistry(address(0)), address(0), 0, miraExpiry);
        vm.expectRevert();
        r2.unregister(miraToken);
        vm.expectRevert();
        r2.setParent(r1, "wrong");
        vm.expectRevert();
        r1.setSubregistry(lockToken, IRegistry(address(0)));
        vm.expectRevert();
        ETH.setSubregistry(rootToken, IRegistry(address(0)));
        vm.expectRevert();
        r2.grantRootRoles(R.ROLE_REGISTRAR, OTHER);
        vm.stopPrank();
        vm.prank(OWNER);
        r2.grantRootRoles(R.ROLE_REGISTRAR | R.ROLE_UNREGISTER, OPERATOR);
        assertEq(r2.roles(r2.ROOT_RESOURCE(), OPERATOR), 4097);
        assertFalse(r2.hasRootRoles(R.ROLE_REGISTRAR_ADMIN | R.ROLE_UNREGISTER_ADMIN, OPERATOR));
        vm.startPrank(OPERATOR);
        uint256 id = r2.register("delegated", GUEST, IRegistry(address(0)), address(0), 0, miraExpiry);
        r2.unregister(id);
        vm.expectRevert();
        r2.grantRootRoles(R.ROLE_REGISTRAR, OTHER);
        vm.stopPrank();
        vm.prank(OWNER);
        r2.revokeRootRoles(4097, OPERATOR);
        vm.startPrank(OPERATOR);
        vm.expectRevert();
        r2.register("afterkill", GUEST, IRegistry(address(0)), address(0), 0, miraExpiry);
        vm.expectRevert();
        r2.unregister(miraToken);
        vm.stopPrank();
        vm.prank(OWNER);
        r2.unregister(miraToken);
        assertFalse(_accept("mira", GUEST, door));
    }

    function testIndividualOperationRolesAreRequired() public {
        vm.startPrank(OWNER);
        r2.revokeRootRoles(R.ROLE_REGISTRAR, OWNER);
        vm.expectRevert();
        r2.register("norole", GUEST, IRegistry(address(0)), address(0), 0, miraExpiry);
        r2.grantRootRoles(R.ROLE_REGISTRAR, OWNER);
        r2.revokeRootRoles(R.ROLE_UNREGISTER, OWNER);
        vm.expectRevert();
        r2.unregister(miraToken);
        r2.grantRootRoles(R.ROLE_UNREGISTER, OWNER);
        r2.revokeRootRoles(R.ROLE_RENEW, OWNER);
        vm.expectRevert();
        r2.renew(miraToken, miraExpiry + 1);
        r2.grantRootRoles(R.ROLE_RENEW, OWNER);
        r2.revokeRootRoles(R.ROLE_SET_PARENT, OWNER);
        vm.expectRevert();
        r2.setParent(r1, "lock");
        r2.grantRootRoles(R.ROLE_SET_PARENT, OWNER);
        // Remove both root and token-scoped authority to isolate attachment permission.
        r1.revokeRootRoles(R.ROLE_SET_SUBREGISTRY, OWNER);
        r1.revokeRoles(lockToken, R.ROLE_SET_SUBREGISTRY, OWNER);
        uint256 current = r1.getTokenId(LibLabel.id("lock"));
        vm.expectRevert();
        r1.setSubregistry(current, IRegistry(address(0)));
        vm.stopPrank();
    }

    function testReservedCredentialRejected() public {
        vm.prank(OWNER);
        uint256 id = r2.register("reserved", address(0), IRegistry(address(0)), address(0), 0, miraExpiry);
        assertEq(uint256(r2.getState(id).status), uint256(IPermissionedRegistry.Status.RESERVED));
        assertFalse(_accept("reserved", GUEST, door));
    }

    function testTransferableCredentialFollowsCurrentENSOwner() public {
        vm.prank(OWNER);
        uint256 id =
            r2.register("transferable", GUEST, IRegistry(address(0)), address(0), R.ROLE_CAN_TRANSFER_ADMIN, miraExpiry);
        assertTrue(_accept("transferable", GUEST, door));
        vm.prank(GUEST);
        r2.unsafeTransfer(OTHER, id, "");
        assertFalse(_accept("transferable", GUEST, door));
        assertTrue(_accept("transferable", OTHER, door));
    }

    function testUnapprovedOperatorCannotTransferTransferableCredential() public {
        vm.prank(OWNER);
        uint256 id =
            r2.register("unapproved", GUEST, IRegistry(address(0)), address(0), R.ROLE_CAN_TRANSFER_ADMIN, miraExpiry);
        for (uint256 method; method < 4; ++method) {
            vm.prank(OPERATOR);
            (bool ok,) = address(r2).call(_transferData(method, id));
            assertFalse(ok);
            assertEq(r2.getOwner(id), GUEST);
        }
    }

    function testRestoringSameAttachmentRestoresCurrentStateAcceptance() public {
        vm.prank(OWNER);
        r1.setSubregistry(lockToken, IRegistry(address(0)));
        assertFalse(_accept("mira", GUEST, door));
        vm.prank(OWNER);
        r1.setSubregistry(lockToken, r2);
        assertTrue(_accept("mira", GUEST, door), "oracle cannot detect past detachment");
    }

    function testRoleChangeRegeneratesTokenWithoutNewRegistrationResource() public {
        uint256 beforeResource = r1.getResource(lockToken);
        vm.prank(OWNER);
        r1.revokeRoles(lockToken, R.ROLE_SET_SUBREGISTRY, OWNER);
        uint256 next = r1.getTokenId(LibLabel.id("lock"));
        assertTrue(next != lockToken);
        assertEq(r1.getResource(next), beforeResource);
        assertFalse(_accept("mira", GUEST, door), "token binding conservatively rejects role churn");
    }

    function testGuestCannotSelfGrantTransferRole() public {
        uint256 resource = r2.getResource(miraToken);
        vm.prank(GUEST);
        vm.expectRevert();
        r2.grantRoles(resource, R.ROLE_CAN_TRANSFER_ADMIN, GUEST);
    }

    function testRegistryRootAdminCannotTransferWithoutGuestApproval() public {
        vm.prank(OWNER);
        uint256 id =
            r2.register("adminprobe", GUEST, IRegistry(address(0)), address(0), R.ROLE_CAN_TRANSFER_ADMIN, miraExpiry);
        for (uint256 method; method < 4; ++method) {
            vm.prank(OWNER);
            (bool ok,) = address(r2).call(_transferData(method, id));
            assertFalse(ok);
            assertEq(r2.getOwner(id), GUEST);
        }
    }

    function testEmancipationRemovesFixtureOwnerRevocationAuthority() public {
        vm.prank(OWNER);
        r2.revokeRootRoles(R.UNEMANCIPATED_ROLE_BITMAP & (OPERATIONS | ADMINS), OWNER);
        assertTrue(r2.isEmancipated());
        assertFalse(r2.hasRootRoles(R.ROLE_UNREGISTER | R.ROLE_UNREGISTER_ADMIN, OWNER));
        vm.prank(OWNER);
        vm.expectRevert();
        r2.unregister(miraToken);
        assertTrue(_accept("mira", GUEST, door), "emancipation alone is not credential revocation");
    }

    function testTransferMatrixUnemancipated() public {
        assertFalse(r2.isEmancipated());
        _transferMatrix(false);
    }

    function testTransferMatrixEmancipated() public {
        vm.prank(OWNER);
        r2.revokeRootRoles(R.UNEMANCIPATED_ROLE_BITMAP & (OPERATIONS | ADMINS), OWNER);
        assertTrue(r2.isEmancipated(), "revoking override roles must emancipate fixture");
        _transferMatrix(true);
    }

    function _transferMatrix(bool emancipated) internal {
        // 2 role bitmaps x 2 actors x 4 transfer entrypoints = 16 cells per state.
        for (uint256 bitmap; bitmap < 2; ++bitmap) {
            for (uint256 actor; actor < 2; ++actor) {
                for (uint256 method; method < 4; ++method) {
                    string memory label =
                        string.concat("probe-", vm.toString(bitmap), "-", vm.toString(actor), "-", vm.toString(method));
                    vm.prank(OWNER);
                    uint256 id = r2.register(
                        label,
                        GUEST,
                        IRegistry(address(0)),
                        address(0),
                        bitmap == 0 ? 0 : R.ROLE_CAN_TRANSFER_ADMIN,
                        miraExpiry
                    );
                    vm.prank(GUEST);
                    r2.setApprovalForAll(OPERATOR, true);
                    bytes memory data = _transferData(method, id);
                    vm.prank(actor == 0 ? GUEST : OPERATOR);
                    (bool ok, bytes memory reason) = address(r2).call(data);
                    console2.log("transfer cell emancipated/bitmap/actor/method", emancipated);
                    console2.log(bitmap, actor, method);
                    console2.log("success", ok);
                    if (!ok) console2.logBytes(reason);
                    // Safe methods require emancipation. All methods also require transfer-admin role.
                    bool expected = bitmap == 1 && (method >= 2 || emancipated);
                    assertEq(ok, expected, "transfer matrix differs from scoped prediction");
                    assertEq(r2.getOwner(id), ok ? OTHER : GUEST);
                }
            }
        }
    }

    function _transferData(uint256 method, uint256 id) internal pure returns (bytes memory) {
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1;
        if (method == 0) {
            return abi.encodeWithSignature(
                "safeTransferFrom(address,address,uint256,uint256,bytes)", GUEST, OTHER, id, 1, bytes("")
            );
        }
        if (method == 1) {
            return abi.encodeWithSignature(
                "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
                GUEST,
                OTHER,
                ids,
                amounts,
                bytes("")
            );
        }
        if (method == 2) return abi.encodeWithSignature("unsafeTransfer(address,uint256,bytes)", OTHER, id, bytes(""));
        return abi.encodeWithSignature("unsafeBatchTransfer(address,uint256[],bytes)", OTHER, ids, bytes(""));
    }
}
