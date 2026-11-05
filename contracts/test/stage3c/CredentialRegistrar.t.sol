// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Vm} from "forge-std/Vm.sol";
import {ThreeLevelENSv2Test} from "../stage3/ThreeLevelENSv2.t.sol";
import {CredentialRegistrar} from "../../src/CredentialRegistrar.sol";
import {IRegistry} from "../../src/ens-vendored/registry/interfaces/IRegistry.sol";
import {IPermissionedRegistry} from "../../src/ens-vendored/registry/interfaces/IPermissionedRegistry.sol";
import {RegistryRolesLib as R} from "../../src/ens-vendored/registry/libraries/RegistryRolesLib.sol";

/// @dev Receiver tries to borrow the registrar's authority during ENS token mint.
contract AttackingGuestReceiver {
    CredentialRegistrar public registrar;
    bool public issueSucceeded;
    bool public revokeSucceeded;

    constructor(CredentialRegistrar registrar_) {
        registrar = registrar_;
    }

    function onERC1155Received(address, address, uint256 id, uint256, bytes calldata) external returns (bytes4) {
        (issueSucceeded,) = address(registrar).call(
            abi.encodeCall(registrar.issue, ("callback-grant", address(0xBEEF), uint64(block.timestamp + 120)))
        );
        (revokeSucceeded,) = address(registrar).call(abi.encodeCall(registrar.revoke, ("receiver", id)));
        return this.onERC1155Received.selector;
    }
}

contract CredentialRegistrarTest is ThreeLevelENSv2Test {
    CredentialRegistrar internal registrar;

    function _registrarSetup() internal {
        registrar = new CredentialRegistrar(OWNER, rootLabel, r1, r2);
        vm.prank(OWNER);
        r2.grantRootRoles(4097, address(registrar));
    }

    function _issue(string memory label, address guest, uint64 expiry) internal returns (uint256) {
        vm.prank(OWNER);
        return registrar.issue(label, guest, expiry);
    }

    function testRegistrarAuthorizedIssueAndRevokeEvents() public {
        _registrarSetup();
        vm.recordLogs();
        uint256 id = _issue("fresh", GUEST, miraExpiry);
        assertEq(r2.getOwner(id), GUEST);
        assertEq(r2.roles(r2.getResource(id), GUEST), 0);
        assertEq(address(r2.getSubregistry("fresh")), address(0));
        assertEq(r2.getResolver("fresh"), address(0));
        assertTrue(_accept("fresh", GUEST, door));
        // Event belongs to this registrar; ENS events are also emitted during issuance.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        Vm.Log memory eventLog = logs[logs.length - 1];
        assertEq(eventLog.emitter, address(registrar));
        assertEq(eventLog.topics[0], keccak256("CredentialIssued(bytes32,uint256,address,uint64)"));
        assertEq(eventLog.topics[1], keccak256("fresh"));
        assertEq(uint256(eventLog.topics[2]), id);
        assertEq(address(uint160(uint256(eventLog.topics[3]))), GUEST);
        assertEq(abi.decode(eventLog.data, (uint64)), miraExpiry);
        vm.prank(OWNER);
        registrar.revoke("fresh", id);
        assertFalse(_accept("fresh", GUEST, door));
        assertEq(r2.getOwner(id), address(0));
    }

    function testRegistrarUnauthorizedIssueRevokeAndApprovedOperator() public {
        _registrarSetup();
        uint256 id = _issue("fresh", GUEST, miraExpiry);
        vm.prank(OWNER);
        r2.setApprovalForAll(OPERATOR, true);
        for (uint256 i; i < 3; ++i) {
            address who = i == 0 ? GUEST : i == 1 ? OTHER : OPERATOR;
            vm.startPrank(who);
            vm.expectRevert(CredentialRegistrar.Unauthorized.selector);
            registrar.issue("intruder", GUEST, miraExpiry);
            vm.expectRevert(CredentialRegistrar.Unauthorized.selector);
            registrar.revoke("fresh", id);
            vm.stopPrank();
        }
        assertEq(r2.getOwner(id), GUEST);
    }

    function testRegistrarRevokedIssueRoleKeepsEmergencyRevoke() public {
        _registrarSetup();
        uint256 id = _issue("fresh", GUEST, miraExpiry);
        vm.prank(OWNER);
        r2.revokeRootRoles(1, address(registrar));
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidPermissions.selector);
        registrar.issue("next", GUEST, miraExpiry);
        vm.prank(OWNER);
        registrar.revoke("fresh", id);
        assertEq(r2.getOwner(id), address(0));
    }

    function testRegistrarRevokedUnregisterRoleBlocksIssueAndRevoke() public {
        _registrarSetup();
        uint256 id = _issue("fresh", GUEST, miraExpiry);
        vm.prank(OWNER);
        r2.revokeRootRoles(4096, address(registrar));
        vm.startPrank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidPermissions.selector);
        registrar.issue("next", GUEST, miraExpiry);
        vm.expectRevert(CredentialRegistrar.InvalidPermissions.selector);
        registrar.revoke("fresh", id);
        r2.unregister(id);
        vm.stopPrank();
        assertEq(r2.getOwner(id), address(0));
    }

    function testRegistrarUnexpectedExtraRolesBlockIssue() public {
        _registrarSetup();
        vm.prank(OWNER);
        r2.grantRootRoles(R.ROLE_RENEW, address(registrar));
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidPermissions.selector);
        registrar.issue("fresh", GUEST, miraExpiry);
    }

    function testRegistrarExpiryBoundsAndBoundary() public {
        _registrarSetup();
        _issue("minimum", GUEST, uint64(block.timestamp + 60));
        _issue("maximum", GUEST, uint64(block.timestamp + 30 days));
        vm.startPrank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidExpiry.selector);
        registrar.issue("short", GUEST, uint64(block.timestamp + 59));
        vm.expectRevert(CredentialRegistrar.InvalidExpiry.selector);
        registrar.issue("long", GUEST, uint64(block.timestamp + 30 days + 1));
        vm.stopPrank();
        vm.warp(lockExpiry - 120);
        _issue("parent-bound", GUEST, lockExpiry);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidExpiry.selector);
        registrar.issue("beyond-parent", GUEST, lockExpiry + 1);
    }

    function testRegistrarExpiredRootAndLockRejectIssue() public {
        _registrarSetup();
        vm.warp(lockExpiry);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        registrar.issue("fresh", GUEST, uint64(block.timestamp + 120));
        vm.warp(rootExpiry);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        registrar.issue("fresh", GUEST, uint64(block.timestamp + 120));
    }

    function testRegistrarRejectsInvalidGuests() public {
        _registrarSetup();
        vm.startPrank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidGuest.selector);
        registrar.issue("fresh", address(0), miraExpiry);
        vm.expectRevert(CredentialRegistrar.InvalidGuest.selector);
        registrar.issue("fresh", OWNER, miraExpiry);
        vm.expectRevert(CredentialRegistrar.InvalidGuest.selector);
        registrar.issue("fresh", address(registrar), miraExpiry);
        r2.grantRootRoles(R.ROLE_REGISTRAR, OTHER);
        vm.expectRevert(CredentialRegistrar.InvalidGuest.selector);
        registrar.issue("fresh", OTHER, miraExpiry);
        vm.stopPrank();
    }

    function testRegistrarLabelValidationAndNoPrivilegeForwarding() public {
        _registrarSetup();
        string[6] memory invalid = [string(""), "ab", "MiRa", "-bad", "bad-", "mira.lock"];
        for (uint256 i; i < invalid.length; ++i) {
            vm.prank(OWNER);
            vm.expectRevert(CredentialRegistrar.InvalidLabel.selector);
            registrar.issue(invalid[i], GUEST, miraExpiry);
        }
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidLabel.selector);
        registrar.issue("abcdefghijklmnopqrstuvwxyz1234567", GUEST, miraExpiry);
        // No generic role/call/privileged-register selector exists.
        vm.prank(OWNER);
        (bool ok,) = address(registrar).call(
            abi.encodeWithSignature("grantRootRoles(uint256,address)", R.ROLE_UNREGISTER_ADMIN, GUEST)
        );
        assertFalse(ok);
    }

    function testRegistrarRejectsActiveRevokedExpiredAndReservedLabelReuse() public {
        _registrarSetup();
        uint256 id = _issue("fresh", GUEST, miraExpiry);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.LabelAlreadyUsed.selector);
        registrar.issue("fresh", OTHER, miraExpiry);
        vm.prank(OWNER);
        registrar.revoke("fresh", id);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.LabelAlreadyUsed.selector);
        registrar.issue("fresh", OTHER, miraExpiry);
        _issue("shortlife", GUEST, uint64(block.timestamp + 60));
        vm.warp(block.timestamp + 60);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.LabelAlreadyUsed.selector);
        registrar.issue("shortlife", GUEST, miraExpiry);
        vm.prank(OWNER);
        r2.register("reserved", address(0), IRegistry(address(0)), address(0), 0, miraExpiry);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.LabelAlreadyUsed.selector);
        registrar.issue("reserved", GUEST, miraExpiry);
    }

    function testRegistrarStaleRevokeCannotRevokeNewGeneration() public {
        _registrarSetup();
        uint256 id = _issue("fresh", GUEST, miraExpiry);
        vm.prank(OWNER);
        registrar.revoke("fresh", id);
        vm.prank(OWNER);
        uint256 replacement = r2.register("fresh", OTHER, IRegistry(address(0)), address(0), 0, miraExpiry);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.StaleCredential.selector);
        registrar.revoke("fresh", id);
        assertEq(r2.getOwner(replacement), OTHER);
        vm.prank(OWNER);
        registrar.revoke("fresh", replacement);
        assertEq(r2.getOwner(replacement), address(0));
    }

    function testRegistrarExpiredCredentialCannotUnlockOrBeUnregistered() public {
        _registrarSetup();
        uint256 id = _issue("shortlife", GUEST, uint64(block.timestamp + 60));
        vm.warp(block.timestamp + 60);
        assertFalse(_accept("shortlife", GUEST, door));
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.StaleCredential.selector);
        registrar.revoke("shortlife", id);
    }

    function testRegistrarDetachmentReplacementAndCleanup() public {
        _registrarSetup();
        uint256 id = _issue("fresh", GUEST, miraExpiry);
        vm.prank(OWNER);
        r1.setSubregistry(lockToken, IRegistry(address(0)));
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        registrar.issue("next", GUEST, miraExpiry);
        vm.prank(OWNER);
        registrar.revoke("fresh", id);
        assertEq(r2.getOwner(id), address(0));
        IPermissionedRegistry replacement = _registry();
        vm.prank(OWNER);
        r1.setSubregistry(lockToken, replacement);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        registrar.issue("next", GUEST, miraExpiry);
        vm.prank(OWNER);
        ETH.setSubregistry(rootToken, replacement);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        registrar.issue("next", GUEST, miraExpiry);
    }

    function testRegistrarOwnerChangesRejectIssue() public {
        _registrarSetup();
        vm.prank(OWNER);
        r1.unsafeTransfer(OTHER, lockToken, "");
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        registrar.issue("fresh", GUEST, miraExpiry);
    }

    function testRegistrarRootOwnerChangeRejectsIssue() public {
        _registrarSetup();
        vm.prank(OWNER);
        ETH.unsafeTransfer(OTHER, rootToken, "");
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        registrar.issue("fresh", GUEST, miraExpiry);
    }

    function testRegistrarLockGenerationRejectsIssue() public {
        _registrarSetup();
        vm.startPrank(OWNER);
        r1.unregister(lockToken);
        r1.register("lock", OWNER, r2, address(0), 0, lockExpiry);
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        registrar.issue("fresh", GUEST, miraExpiry);
        vm.stopPrank();
    }

    function testRegistrarRoleChurnRejectsIssue() public {
        _registrarSetup();
        vm.prank(OWNER);
        r1.revokeRoles(lockToken, R.ROLE_SET_SUBREGISTRY, OWNER);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        registrar.issue("fresh", GUEST, miraExpiry);
    }

    function testRegistrarRejectsInvalidConstructorConfiguration() public {
        _registrarSetup();
        vm.expectRevert(CredentialRegistrar.InvalidConfiguration.selector);
        new CredentialRegistrar(address(0), rootLabel, r1, r2);
        vm.expectRevert(CredentialRegistrar.InvalidConfiguration.selector);
        new CredentialRegistrar(OWNER, rootLabel, r1, r1);
        vm.expectRevert(CredentialRegistrar.InvalidConfiguration.selector);
        new CredentialRegistrar(OWNER, rootLabel, r1, IPermissionedRegistry(OTHER));
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        new CredentialRegistrar(OTHER, rootLabel, r1, r2);
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        new CredentialRegistrar(OWNER, "unregistered-root", r1, r2);
    }

    function testRegistrarReceiverCallbackCannotUseIssuerAuthority() public {
        _registrarSetup();
        AttackingGuestReceiver receiver = new AttackingGuestReceiver(registrar);
        uint256 id = _issue("receiver", address(receiver), miraExpiry);
        assertEq(r2.getOwner(id), address(receiver));
        assertFalse(receiver.issueSucceeded());
        assertFalse(receiver.revokeSucceeded());
        vm.prank(OWNER);
        registrar.revoke("receiver", id);
        assertEq(r2.getOwner(id), address(0));
    }

    function testRegistrarGuestAndOperatorCannotEmancipateOrTransferIssuedCredential() public {
        _registrarSetup();
        uint256 id = _issue("fresh", GUEST, miraExpiry);
        vm.prank(GUEST);
        r2.setApprovalForAll(OPERATOR, true);
        for (uint256 i; i < 2; ++i) {
            address who = i == 0 ? GUEST : OPERATOR;
            vm.prank(who);
            vm.expectRevert();
            r2.revokeRootRoles(4096, address(registrar));
            uint256 resource = r2.getResource(id);
            vm.prank(who);
            vm.expectRevert();
            r2.grantRoles(resource, R.ROLE_CAN_TRANSFER_ADMIN, who);
            for (uint256 method; method < 4; ++method) {
                vm.prank(who);
                (bool ok,) = address(r2).call(_transferData(method, id));
                assertFalse(ok);
            }
        }
        assertFalse(r2.isEmancipated());
        vm.prank(OWNER);
        registrar.revoke("fresh", id);
        assertEq(r2.getOwner(id), address(0));
    }

    function testRegistrarRetainedRoleMitigationSurvivesOwnerDroppingOwnRoles() public {
        _registrarSetup();
        uint256 id = _issue("fresh", GUEST, miraExpiry);
        vm.prank(OWNER);
        r2.revokeRootRoles(OPERATIONS | ADMINS, OWNER);
        assertFalse(r2.isEmancipated());
        vm.prank(OWNER);
        registrar.revoke("fresh", id);
        assertEq(r2.getOwner(id), address(0));
    }

    function testRegistrarRegistryReadFailureFailsClosed() public {
        _registrarSetup();
        vm.mockCallRevert(address(r1), abi.encodeCall(r1.getState, (uint256(keccak256("lock")))), bytes("unavailable"));
        vm.prank(OWNER);
        vm.expectRevert();
        registrar.issue("fresh", GUEST, miraExpiry);
        vm.clearMockedCalls();
        assertEq(r2.getOwner(uint256(keccak256("fresh"))), address(0));
    }

    function testRegistrarRootGenerationRejectsWithOtherwiseValidPath() public {
        _registrarSetup();
        uint256 grace = REGISTRAR.GRACE_PERIOD();
        vm.prank(OWNER);
        r1.renew(lockToken, uint64(uint256(rootExpiry) + grace + 90 days));
        vm.warp(uint256(rootExpiry) + grace + 1);
        uint256 next = _registerRoot(OWNER);
        vm.prank(OWNER);
        ETH.setSubregistry(next, r1);
        assertEq(r1.getTokenId(uint256(keccak256("lock"))), lockToken);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        registrar.issue("new-root", GUEST, uint64(block.timestamp + 120));
        CredentialRegistrar rebound = new CredentialRegistrar(OWNER, rootLabel, r1, r2);
        vm.prank(OWNER);
        r2.grantRootRoles(4097, address(rebound));
        vm.prank(OWNER);
        uint256 id = rebound.issue("new-root", GUEST, uint64(block.timestamp + 120));
        assertEq(r2.getOwner(id), GUEST);
    }

    function testRegistrarWrongChainAndImplementationFailClosed() public {
        _registrarSetup();
        vm.chainId(1);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        registrar.issue("fresh", GUEST, miraExpiry);
        vm.expectRevert(CredentialRegistrar.InvalidConfiguration.selector);
        new CredentialRegistrar(OWNER, rootLabel, r1, r2);
        vm.chainId(11155111);
        vm.mockCall(address(FACTORY), abi.encodeCall(FACTORY.verifyContract, (address(r2))), abi.encode(OTHER));
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidConfiguration.selector);
        registrar.issue("fresh", GUEST, miraExpiry);
        vm.clearMockedCalls();
    }

    function testRegistrarRestoredPathIsCurrentStateNotPermanentInvalidation() public {
        _registrarSetup();
        vm.prank(OWNER);
        r1.setSubregistry(lockToken, IRegistry(address(0)));
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        registrar.issue("fresh", GUEST, miraExpiry);
        vm.prank(OWNER);
        r1.setSubregistry(lockToken, r2);
        assertEq(r2.getOwner(_issue("fresh", GUEST, miraExpiry)), GUEST);
    }

    function testRegistrarRejectsLockExpiryBeyondRoot() public {
        _registrarSetup();
        vm.prank(OWNER);
        r1.renew(lockToken, rootExpiry + 1);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidHierarchy.selector);
        registrar.issue("fresh", GUEST, miraExpiry);
    }

    function testRegistrarBadRegistryPostconditionRollsBackMint() public {
        _registrarSetup();
        uint256 labelId = uint256(keccak256("fresh"));
        vm.mockCall(address(r2), abi.encodeCall(r2.getOwner, (labelId)), abi.encode(OTHER));
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.RegistryPostconditionFailed.selector);
        registrar.issue("fresh", GUEST, miraExpiry);
        vm.clearMockedCalls();
        assertEq(r2.getState(labelId).expiry, 0, "registration must roll back atomically");
    }
}
