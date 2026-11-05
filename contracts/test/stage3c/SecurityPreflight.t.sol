// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ThreeLevelENSv2Test} from "../stage3/ThreeLevelENSv2.t.sol";
import {IRegistry} from "../../src/ens-vendored/registry/interfaces/IRegistry.sol";
import {IPermissionedRegistry} from "../../src/ens-vendored/registry/interfaces/IPermissionedRegistry.sol";
import {Grant} from "../../src/ens-vendored/access-control/interfaces/IEACGrantInitializable.sol";
import {RegistryRolesLib as R} from "../../src/ens-vendored/registry/libraries/RegistryRolesLib.sol";
import {console2} from "forge-std/console2.sol";

/// @dev Pre-production proof helper, never a deployment artifact.
contract RestrictedRegistrarProbe {
    address public immutable owner;
    IPermissionedRegistry public immutable registry;

    error Unauthorized();

    constructor(address owner_, IPermissionedRegistry registry_) {
        owner = owner_;
        registry = registry_;
    }

    function issue(string calldata label, address guest, uint64 expiry) external returns (uint256) {
        if (msg.sender != owner) revert Unauthorized();
        return registry.register(label, guest, IRegistry(address(0)), address(0), 0, expiry);
    }

    function revoke(uint256 id) external {
        if (msg.sender != owner) revert Unauthorized();
        registry.unregister(id);
    }
}

contract CredentialSecurityPreflightTest is ThreeLevelENSv2Test {
    function _probe() internal returns (RestrictedRegistrarProbe p) {
        p = new RestrictedRegistrarProbe(OWNER, r2);
        vm.prank(OWNER);
        r2.grantRootRoles(4097, address(p));
        assertEq(r2.roles(r2.ROOT_RESOURCE(), address(p)), 4097);
    }

    function testSecurityMinimalRegistrarCallerRestrictions() public {
        RestrictedRegistrarProbe p = _probe();
        vm.prank(OWNER);
        uint256 id = p.issue("proof", GUEST, miraExpiry);
        assertEq(r2.getOwner(id), GUEST);
        vm.startPrank(OTHER);
        vm.expectRevert(RestrictedRegistrarProbe.Unauthorized.selector);
        p.issue("intruder", OTHER, miraExpiry);
        vm.expectRevert(RestrictedRegistrarProbe.Unauthorized.selector);
        p.revoke(id);
        vm.stopPrank();
        vm.prank(OWNER);
        p.revoke(id);
        assertEq(uint256(r2.getState(id).status), uint256(IPermissionedRegistry.Status.AVAILABLE));
        assertEq(r2.getOwner(id), address(0));
    }

    function testSecurityGuestOperatorAndDelegatedRoleCannotEmancipate() public {
        RestrictedRegistrarProbe p = _probe();
        vm.prank(GUEST);
        r2.setApprovalForAll(OPERATOR, true);
        // Ordinary role delegation is possible, but confers no admin authority.
        vm.prank(OWNER);
        r2.grantRoles(miraToken, R.ROLE_RENEW, GUEST);
        uint256 resource = r2.getResource(miraToken);
        uint256 beforeOwner = r2.roles(r2.ROOT_RESOURCE(), OWNER);
        for (uint256 who; who < 2; ++who) {
            address caller = who == 0 ? GUEST : OPERATOR;
            bytes[] memory attempts = new bytes[](10);
            attempts[0] = abi.encodeCall(r2.grantRootRoles, (R.ROLE_UNREGISTER_ADMIN, caller));
            attempts[1] = abi.encodeCall(r2.grantRoles, (resource, R.ROLE_UNREGISTER_ADMIN, caller));
            attempts[2] = abi.encodeCall(r2.grantRoles, (resource, R.ROLE_CAN_TRANSFER_ADMIN, caller));
            attempts[3] = abi.encodeCall(r2.revokeRootRoles, (R.ROLE_UNREGISTER | R.ROLE_UNREGISTER_ADMIN, OWNER));
            attempts[4] = abi.encodeCall(r2.revokeRootRoles, (4097, address(p)));
            attempts[5] = abi.encodeCall(r2.revokeRoles, (r2.ROOT_RESOURCE(), beforeOwner, OWNER));
            attempts[6] = abi.encodeCall(r2.setSubregistry, (resource, IRegistry(OTHER)));
            attempts[7] = abi.encodeCall(r2.setParent, (IRegistry(OTHER), "fake"));
            attempts[8] = abi.encodeWithSignature("initialize((address,uint256)[])", new Grant[](0));
            attempts[9] = abi.encodeWithSignature("upgradeToAndCall(address,bytes)", IMPL, bytes(""));
            for (uint256 i; i < attempts.length; ++i) {
                vm.prank(caller);
                (bool ok,) = address(r2).call(attempts[i]);
                assertFalse(ok, "guest/operator escalation succeeded");
                assertFalse(r2.isEmancipated());
                assertEq(r2.roles(r2.ROOT_RESOURCE(), OWNER), beforeOwner);
                assertEq(r2.roles(r2.ROOT_RESOURCE(), address(p)), 4097);
            }
        }
        uint256 current = r2.getTokenId(resource);
        vm.prank(OWNER);
        p.revoke(current);
        assertEq(r2.getOwner(resource), address(0));
    }

    function testSecurityRetainedRegistrarPreventsEmancipationAfterOwnerDropsOwnOverrides() public {
        RestrictedRegistrarProbe p = _probe();
        vm.prank(OWNER);
        r2.revokeRootRoles(OPERATIONS | ADMINS, OWNER);
        assertFalse(r2.isEmancipated(), "registrar UNREGISTER must retain root control");
        vm.prank(OWNER);
        p.revoke(miraToken);
        assertEq(r2.getOwner(miraToken), address(0));
    }

    function testSecurityOwnerCanDeliberatelyDisableRevocation() public {
        RestrictedRegistrarProbe p = _probe();
        vm.startPrank(OWNER);
        r2.revokeRootRoles(4097, address(p));
        r2.revokeRootRoles(OPERATIONS | ADMINS, OWNER);
        vm.stopPrank();
        assertTrue(r2.isEmancipated());
        vm.prank(OWNER);
        vm.expectRevert();
        p.revoke(miraToken);
        assertEq(r2.getOwner(miraToken), GUEST);
    }

    function testSecurityZeroRoleApprovalsAndMixedBatchCannotTransfer() public {
        vm.prank(OWNER);
        uint256 capable =
            r2.register("capable", GUEST, IRegistry(address(0)), address(0), R.ROLE_CAN_TRANSFER_ADMIN, miraExpiry);
        vm.prank(GUEST);
        r2.setApprovalForAll(OPERATOR, true);
        assertTrue(r2.isApprovedForAll(GUEST, OPERATOR), "approval itself is allowed");
        uint256[] memory ids = new uint256[](2);
        ids[0] = capable;
        ids[1] = miraToken;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1;
        amounts[1] = 1;
        for (uint256 who; who < 2; ++who) {
            address caller = who == 0 ? GUEST : OPERATOR;
            for (uint256 method; method < 4; ++method) {
                vm.prank(caller);
                (bool ok,) = address(r2).call(_transferData(method, miraToken));
                assertFalse(ok);
            }
            vm.prank(caller);
            (bool unsafeOK,) = address(r2).call(
                abi.encodeWithSignature("unsafeBatchTransfer(address,uint256[],bytes)", OTHER, ids, bytes(""))
            );
            assertFalse(unsafeOK);
            vm.prank(caller);
            (bool safeOK,) = address(r2).call(
                abi.encodeWithSignature(
                    "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
                    GUEST,
                    OTHER,
                    ids,
                    amounts,
                    bytes("")
                )
            );
            assertFalse(safeOK);
            assertEq(r2.getOwner(capable), GUEST);
            assertEq(r2.getOwner(miraToken), GUEST);
        }
        vm.prank(GUEST);
        r2.setApprovalForAll(OPERATOR, false);
        assertFalse(r2.isApprovedForAll(GUEST, OPERATOR));
        vm.prank(OWNER);
        r2.unregister(miraToken);
        assertEq(r2.getOwner(miraToken), address(0));
    }

    function testSecurityRootTransferAdminEmancipationCompatibilityProbe() public {
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(OWNER, R.ROLE_CAN_TRANSFER_ADMIN);
        IPermissionedRegistry registry = IPermissionedRegistry(
            FACTORY.deployProxy(IMPL, ++salt, abi.encodeWithSignature("initialize((address,uint256)[])", grants))
        );
        console2.log("rootTransferAdminOnlyIsEmancipated", registry.isEmancipated());
        // Source linked by ENS docs includes this role in UNEMANCIPATED_ROLE_BITMAP;
        // the old vendored library omits it. This assertion decides compatibility.
        assertFalse(registry.isEmancipated(), "deployed code differs from deployment-linked source mask");
    }

    function testSecurityRevocationReuseAndExpiryGeneration() public {
        uint256 oldResource = r2.getResource(miraToken);
        vm.prank(OWNER);
        r2.unregister(miraToken);
        IPermissionedRegistry.State memory revoked = r2.getState(miraToken);
        assertEq(uint256(revoked.status), 0);
        assertEq(revoked.latestOwner, address(0));
        assertTrue(revoked.tokenId != miraToken);
        assertTrue(revoked.resource != oldResource);
        vm.prank(OWNER);
        uint256 same = r2.register("mira", GUEST, IRegistry(address(0)), address(0), 0, miraExpiry);
        assertTrue(same != miraToken);
        assertEq(r2.getOwner(same), GUEST);
        vm.prank(OWNER);
        r2.unregister(same);
        vm.prank(OWNER);
        uint256 reassigned = r2.register("mira", OTHER, IRegistry(address(0)), address(0), 0, miraExpiry);
        assertEq(r2.getOwner(reassigned), OTHER, "freshly revoked label may be reassigned");
        vm.prank(OWNER);
        r2.unregister(reassigned);
        vm.prank(OWNER);
        same = r2.register("mira", GUEST, IRegistry(address(0)), address(0), 0, miraExpiry);
        vm.warp(miraExpiry);
        assertEq(uint256(r2.getState(same).status), 0);
        assertEq(r2.getOwner(same), address(0));
        vm.prank(OWNER);
        r2.renew(same, uint64(block.timestamp + 120));
        assertEq(r2.getOwner(same), GUEST, "root renew can revive expired label");
        vm.prank(OWNER);
        r2.renew(same, rootExpiry + 1);
        assertFalse(_accept("mira", GUEST, door), "ENS does not cap ancestors automatically");
    }
}
