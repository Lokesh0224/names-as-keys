// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Vm} from "forge-std/Vm.sol";
import {ThreeLevelENSv2Test} from "../stage3/ThreeLevelENSv2.t.sol";
import {DoorKeys} from "../../src/DoorKeys.sol";
import {CredentialRegistrar} from "../../src/CredentialRegistrar.sol";
import {IPermissionedRegistry} from "../../src/ens-vendored/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "../../src/ens-vendored/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib as R} from "../../src/ens-vendored/registry/libraries/RegistryRolesLib.sol";
import {LibLabel} from "../../src/ens-vendored/utils/LibLabel.sol";

contract UnlockingGuest {
    uint256 public receiverCalls;
    bool public rejectHooks;

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        require(!rejectHooks, "unexpected receiver callback");
        ++receiverCalls;
        return this.onERC1155Received.selector;
    }

    function disableReceiverHooks() external {
        rejectHooks = true;
    }

    function request(DoorKeys target, string calldata label) external {
        target.unlock(label);
    }
}

contract MutatingRegistryReadProbe {
    fallback() external {
        assembly {
            sstore(0, 1)
        }
    }
}

contract DoorKeysTest is ThreeLevelENSv2Test {
    function _door() internal returns (DoorKeys) {
        return new DoorKeys(OWNER, rootLabel, r1, r2, 1);
    }

    function _unlock(DoorKeys target, string memory label, address caller) internal {
        vm.prank(caller);
        target.unlock(label);
    }

    function _denied(DoorKeys target, string memory label, address caller, bytes4 reason) internal {
        uint256 nonce = target.requestNonce();
        vm.recordLogs();
        vm.prank(caller);
        (bool ok, bytes memory data) = address(target).call{gas: 2_000_000}(abi.encodeCall(target.unlock, (label)));
        assertFalse(ok, "authorization unexpectedly succeeded");
        if (reason != bytes4(0)) assertEq(bytes4(data), reason);
        assertEq(target.requestNonce(), nonce, "denial consumed nonce");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].emitter != address(target), "denial emitted door event");
        }
    }

    function testDoorMiraUnlockEventAndDoorIdentity() public {
        DoorKeys target = _door();
        bytes32 expected = keccak256(
            abi.encode(
                block.chainid,
                address(target),
                keccak256(bytes(rootLabel)),
                keccak256("lock"),
                r1,
                r2,
                rootToken,
                lockToken,
                uint256(1)
            )
        );
        assertEq(target.doorId(), expected);
        vm.recordLogs();
        _unlock(target, "mira", GUEST);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].emitter, address(target));
        assertEq(logs[0].topics.length, 4);
        assertEq(logs[0].topics[0], keccak256("DoorUnlocked(bytes32,address,bytes32,uint256,uint64,uint256)"));
        assertEq(logs[0].topics[1], expected);
        assertEq(address(uint160(uint256(logs[0].topics[2]))), GUEST);
        assertEq(logs[0].topics[3], keccak256("mira"));
        (uint256 id, uint64 expiry, uint256 nonce) = abi.decode(logs[0].data, (uint256, uint64, uint256));
        assertEq(id, miraToken);
        assertEq(expiry, miraExpiry);
        assertEq(nonce, 1);
        assertEq(target.requestNonce(), 1);
        assertEq(r2.getOwner(miraToken), GUEST);
        assertEq(r2.roles(r2.ROOT_RESOURCE(), address(target)), 0, "door received ENS roles");
        _unlock(target, "mira", GUEST);
        assertEq(target.requestNonce(), 2);
    }

    function testDoorWrongWalletAndApprovedOperatorDenied() public {
        DoorKeys target = _door();
        vm.prank(GUEST);
        r2.setApprovalForAll(OPERATOR, true);
        _denied(target, "mira", OTHER, DoorKeys.InvalidCredential.selector);
        _denied(target, "mira", OPERATOR, DoorKeys.InvalidCredential.selector);
        _unlock(target, "mira", GUEST);
    }

    function testDoorRevokedMissingReservedDenied() public {
        DoorKeys target = _door();
        _denied(target, "missing", GUEST, DoorKeys.InvalidCredential.selector);
        vm.prank(OWNER);
        r2.register("reserved", address(0), IRegistry(address(0)), address(0), 0, miraExpiry);
        _denied(target, "reserved", GUEST, DoorKeys.InvalidCredential.selector);
        vm.prank(OWNER);
        r2.unregister(miraToken);
        _denied(target, "mira", GUEST, DoorKeys.InvalidCredential.selector);
    }

    function testDoorCredentialExpiryBoundary() public {
        DoorKeys target = _door();
        vm.warp(miraExpiry - 1);
        _unlock(target, "mira", GUEST);
        vm.warp(miraExpiry);
        _denied(target, "mira", GUEST, DoorKeys.InvalidCredential.selector);
    }

    function testDoorAncestorExpiryAndBounds() public {
        DoorKeys target = _door();
        vm.prank(OWNER);
        r2.renew(miraToken, lockExpiry);
        vm.warp(lockExpiry - 1);
        _unlock(target, "mira", GUEST);
        vm.warp(lockExpiry);
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
    }

    function testDoorRootExpiryWithAlignedDescendants() public {
        DoorKeys target = _door();
        vm.prank(OWNER);
        r1.renew(lockToken, rootExpiry);
        vm.prank(OWNER);
        r2.renew(miraToken, rootExpiry);
        vm.warp(rootExpiry - 1);
        _unlock(target, "mira", GUEST);
        vm.warp(rootExpiry);
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
    }

    function testDoorDescendantExpiryBeyondAncestorsDenied() public {
        DoorKeys target = _door();
        vm.prank(OWNER);
        r2.renew(miraToken, lockExpiry + 1);
        _denied(target, "mira", GUEST, DoorKeys.InvalidCredential.selector);
        vm.prank(OWNER);
        r1.renew(lockToken, rootExpiry + 1);
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
    }

    function testDoorDetachedReplacedR1Denied() public {
        DoorKeys target = _door();
        vm.prank(OWNER);
        ETH.setSubregistry(rootToken, IRegistry(address(0)));
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
        IPermissionedRegistry other = _registry();
        vm.prank(OWNER);
        ETH.setSubregistry(rootToken, other);
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
        assertEq(r2.getOwner(miraToken), GUEST);
    }

    function testDoorDetachedReplacedR2Denied() public {
        DoorKeys target = _door();
        vm.prank(OWNER);
        r1.setSubregistry(lockToken, IRegistry(address(0)));
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
        IPermissionedRegistry other = _registry();
        vm.prank(OWNER);
        r1.setSubregistry(lockToken, other);
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
    }

    function testDoorRootAndLockOwnershipChangesDeniedAndRestored() public {
        DoorKeys target = _door();
        vm.prank(OWNER);
        ETH.unsafeTransfer(OTHER, rootToken, "");
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
        vm.prank(OTHER);
        ETH.unsafeTransfer(OWNER, rootToken, "");
        _unlock(target, "mira", GUEST);
        vm.prank(OWNER);
        r1.unsafeTransfer(OTHER, lockToken, "");
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
        vm.prank(OTHER);
        r1.unsafeTransfer(OWNER, lockToken, "");
        _unlock(target, "mira", GUEST);
    }

    function testDoorLockGenerationChangeDenied() public {
        DoorKeys target = _door();
        vm.startPrank(OWNER);
        r1.unregister(lockToken);
        uint256 next = r1.register("lock", OWNER, r2, address(0), 0, lockExpiry);
        vm.stopPrank();
        assertTrue(next != lockToken);
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
        DoorKeys rebound = _door();
        _unlock(rebound, "mira", GUEST);
        assertTrue(rebound.doorId() != target.doorId());
    }

    function testDoorRootGenerationChangeDeniedWithOtherwiseValidPath() public {
        DoorKeys target = _door();
        uint256 grace = REGISTRAR.GRACE_PERIOD();
        vm.prank(OWNER);
        r1.renew(lockToken, uint64(uint256(rootExpiry) + grace + 90 days));
        vm.warp(uint256(rootExpiry) + grace + 1);
        uint256 next = _registerRoot(OWNER);
        vm.prank(OWNER);
        ETH.setSubregistry(next, r1);
        vm.prank(OWNER);
        r2.renew(miraToken, uint64(block.timestamp + 120));
        assertEq(r1.getTokenId(LibLabel.id("lock")), lockToken);
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
        DoorKeys rebound = _door();
        _unlock(rebound, "mira", GUEST);
    }

    function testDoorAncestorRoleChurnDenied() public {
        DoorKeys target = _door();
        vm.prank(OWNER);
        r1.revokeRoles(lockToken, R.ROLE_SET_SUBREGISTRY, OWNER);
        assertTrue(r1.getState(lockToken).tokenId != lockToken);
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
    }

    function testDoorGuestOwnershipTransferAndRoleRequirements() public {
        DoorKeys target = _door();
        vm.prank(OWNER);
        uint256 id =
            r2.register("transferable", GUEST, IRegistry(address(0)), address(0), R.ROLE_CAN_TRANSFER_ADMIN, miraExpiry);
        _denied(target, "transferable", GUEST, DoorKeys.InvalidCredential.selector);
        vm.prank(GUEST);
        r2.unsafeTransfer(OTHER, id, "");
        _denied(target, "transferable", GUEST, DoorKeys.InvalidCredential.selector);
        _denied(target, "transferable", OTHER, DoorKeys.InvalidCredential.selector);
    }

    function testDoorAdminLabelReuseFollowsCurrentOwnerAndEventGeneration() public {
        DoorKeys target = _door();
        vm.prank(OWNER);
        r2.unregister(miraToken);
        _denied(target, "mira", GUEST, DoorKeys.InvalidCredential.selector);
        vm.prank(OWNER);
        uint256 next = r2.register("mira", OTHER, IRegistry(address(0)), address(0), 0, miraExpiry);
        assertTrue(next != miraToken);
        _denied(target, "mira", GUEST, DoorKeys.InvalidCredential.selector);
        vm.recordLogs();
        _unlock(target, "mira", OTHER);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (uint256 id,,) = abi.decode(logs[0].data, (uint256, uint64, uint256));
        assertEq(id, next);
    }

    function testDoorAdminRenewalRestoresOnlyValidCurrentState() public {
        DoorKeys target = _door();
        vm.warp(miraExpiry);
        _denied(target, "mira", GUEST, DoorKeys.InvalidCredential.selector);
        vm.prank(OWNER);
        r2.renew(miraToken, uint64(block.timestamp + 120));
        _denied(target, "mira", OTHER, DoorKeys.InvalidCredential.selector);
        _unlock(target, "mira", GUEST);
        vm.prank(OWNER);
        r2.renew(miraToken, lockExpiry + 1);
        _denied(target, "mira", GUEST, DoorKeys.InvalidCredential.selector);
    }

    function testDoorRestoredAttachmentsFollowCurrentStatePolicy() public {
        DoorKeys target = _door();
        vm.prank(OWNER);
        r1.setSubregistry(lockToken, IRegistry(address(0)));
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
        vm.prank(OWNER);
        r1.setSubregistry(lockToken, r2);
        _unlock(target, "mira", GUEST);
        vm.prank(OWNER);
        ETH.setSubregistry(rootToken, IRegistry(address(0)));
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
        vm.prank(OWNER);
        ETH.setSubregistry(rootToken, r1);
        _unlock(target, "mira", GUEST);
    }

    function testDoorGuestAndNonOwnerRoleAssigneesDenied() public {
        DoorKeys target = _door();
        vm.prank(OWNER);
        r2.grantRoles(miraToken, R.ROLE_RENEW, OTHER);
        assertEq(r2.roles(r2.getResource(miraToken), GUEST), 0);
        assertTrue(r2.roleCount(miraToken) != 0);
        _denied(target, "mira", GUEST, DoorKeys.InvalidCredential.selector);
        vm.prank(OWNER);
        r2.revokeRoles(miraToken, R.ROLE_RENEW, OTHER);
        _unlock(target, "mira", GUEST);
        vm.prank(OWNER);
        r2.grantRootRoles(R.ROLE_REGISTRAR, GUEST);
        _denied(target, "mira", GUEST, DoorKeys.InvalidCredential.selector);
    }

    function testDoorEmancipationDeniedEvenIfGuestStillOwnsToken() public {
        DoorKeys target = _door();
        vm.prank(OWNER);
        r2.revokeRootRoles(OPERATIONS | ADMINS, OWNER);
        assertTrue(r2.isEmancipated());
        _denied(target, "mira", GUEST, DoorKeys.InvalidCredential.selector);
    }

    function testDoorRegistrarPermissionRevocationIsNotCredentialRevocation() public {
        DoorKeys target = _door();
        CredentialRegistrar issuer = new CredentialRegistrar(OWNER, rootLabel, r1, r2);
        vm.startPrank(OWNER);
        r2.grantRootRoles(4097, address(issuer));
        issuer.issue("issued", GUEST, miraExpiry);
        r2.revokeRootRoles(4097, address(issuer));
        vm.stopPrank();
        _unlock(target, "issued", GUEST);
        vm.prank(OWNER);
        r2.unregister(LibLabel.id("issued"));
        _denied(target, "issued", GUEST, DoorKeys.InvalidCredential.selector);
    }

    function testDoorUnexpectedReadFailuresAndMalformedDataFailClosed() public {
        DoorKeys target = _door();
        bytes memory callData = abi.encodeCall(r2.getState, (LibLabel.id("mira")));
        vm.mockCallRevert(address(r2), callData, bytes("registry unavailable"));
        _denied(target, "mira", GUEST, bytes4(0));
        vm.clearMockedCalls();
        vm.mockCall(address(r2), callData, hex"01");
        _denied(target, "mira", GUEST, bytes4(0));
        vm.clearMockedCalls();
        vm.mockCallRevert(
            address(FACTORY), abi.encodeCall(FACTORY.verifyContract, (address(r2))), bytes("verification unavailable")
        );
        _denied(target, "mira", GUEST, bytes4(0));
        vm.clearMockedCalls();
        vm.mockCall(address(FACTORY), abi.encodeCall(FACTORY.verifyContract, (address(r2))), abi.encode(OTHER));
        _denied(target, "mira", GUEST, DoorKeys.InvalidConfiguration.selector);
        vm.clearMockedCalls();
        _unlock(target, "mira", GUEST);
    }

    function testDoorWrongChainAndGlobalAttachmentDenied() public {
        DoorKeys target = _door();
        vm.chainId(1);
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
        vm.chainId(11155111);
        vm.mockCall(address(ROOT), abi.encodeCall(ROOT.getSubregistry, ("eth")), abi.encode(OTHER));
        _denied(target, "mira", GUEST, DoorKeys.InvalidHierarchy.selector);
        vm.clearMockedCalls();
    }

    function testDoorDistinctContractsAndEpochsHaveDistinctIdentities() public {
        DoorKeys a = _door();
        DoorKeys b = _door();
        DoorKeys c = new DoorKeys(OWNER, rootLabel, r1, r2, 2);
        assertTrue(a.doorId() != b.doorId());
        assertTrue(a.doorId() != c.doorId());
        assertEq(c.deploymentEpoch(), 2);
        _unlock(a, "mira", GUEST);
        _unlock(b, "mira", GUEST);
        assertEq(a.requestNonce(), 1);
        assertEq(b.requestNonce(), 1);
        assertEq(c.requestNonce(), 0);
    }

    function testDoorInvalidLabelsAndConstructorInputs() public {
        DoorKeys target = _door();
        _denied(target, "", GUEST, DoorKeys.InvalidLabel.selector);
        _denied(target, "MiRa", GUEST, DoorKeys.InvalidLabel.selector);
        _denied(target, "mira.lock", GUEST, DoorKeys.InvalidLabel.selector);
        _denied(target, "-mira", GUEST, DoorKeys.InvalidLabel.selector);
        _denied(target, "ab", GUEST, DoorKeys.InvalidLabel.selector);
        _denied(target, "abcdefghijklmnopqrstuvwxyz1234567", GUEST, DoorKeys.InvalidLabel.selector);
        vm.expectRevert(DoorKeys.InvalidConfiguration.selector);
        new DoorKeys(address(0), rootLabel, r1, r2, 1);
        vm.expectRevert(DoorKeys.InvalidConfiguration.selector);
        new DoorKeys(OWNER, rootLabel, r1, r1, 1);
        vm.expectRevert(DoorKeys.InvalidConfiguration.selector);
        new DoorKeys(OWNER, rootLabel, r1, IPermissionedRegistry(OTHER), 1);
        vm.expectRevert(DoorKeys.InvalidHierarchy.selector);
        new DoorKeys(OTHER, rootLabel, r1, r2, 1);
    }

    function testDoorUnlockDoesNotCallGuestReceiverOrChangeENS() public {
        DoorKeys target = _door();
        UnlockingGuest wallet = new UnlockingGuest();
        vm.prank(OWNER);
        uint256 id = r2.register("wallet", address(wallet), IRegistry(address(0)), address(0), 0, miraExpiry);
        assertEq(wallet.receiverCalls(), 1, "real ENS mint invokes receiver once");
        wallet.disableReceiverHooks();
        uint256 rootBefore = ETH.getState(rootToken).tokenId;
        uint256 lockBefore = r1.getState(lockToken).tokenId;
        uint256 rootRolesBefore = r2.roleCount(r2.ROOT_RESOURCE());
        wallet.request(target, "wallet");
        assertEq(wallet.receiverCalls(), 1, "unlock must not invoke receiver hook");
        assertEq(target.requestNonce(), 1);
        assertEq(ETH.getState(rootToken).tokenId, rootBefore);
        assertEq(r1.getState(lockToken).tokenId, lockBefore);
        assertEq(r2.getState(id).tokenId, id);
        assertEq(r2.getOwner(id), address(wallet));
        assertEq(r2.roleCount(id), 0);
        assertEq(r2.roleCount(r2.ROOT_RESOURCE()), rootRolesBefore);
    }

    function testDoorStaticRegistryReadCannotMutateState() public {
        DoorKeys target = _door();
        MutatingRegistryReadProbe bad = new MutatingRegistryReadProbe();
        // Negative fault injection only: not claimed behavior of deployed ENS.
        vm.etch(address(r2), address(bad).code);
        vm.mockCall(address(FACTORY), abi.encodeCall(FACTORY.verifyContract, (address(r2))), abi.encode(IMPL));
        bytes32 beforeSlot = vm.load(address(r2), bytes32(0));
        _denied(target, "mira", GUEST, bytes4(0));
        assertEq(vm.load(address(r2), bytes32(0)), beforeSlot, "STATICCALL must not persist SSTORE");
        vm.clearMockedCalls();
    }
}
