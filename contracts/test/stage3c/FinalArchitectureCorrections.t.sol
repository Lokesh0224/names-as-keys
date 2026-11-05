// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ThreeLevelENSv2Test} from "../stage3/ThreeLevelENSv2.t.sol";
import {CredentialRegistrar} from "../../src/CredentialRegistrar.sol";
import {IRegistry} from "../../src/ens-vendored/registry/interfaces/IRegistry.sol";
import {IPermissionedRegistry} from "../../src/ens-vendored/registry/interfaces/IPermissionedRegistry.sol";
import {LibLabel} from "../../src/ens-vendored/utils/LibLabel.sol";
import {RegistryRolesLib as R} from "../../src/ens-vendored/registry/libraries/RegistryRolesLib.sol";

/// @dev Test-only demonstration of atomic administrative expired-token cleanup.
///      Not a production cleanup API or an authorized deployment artifact.
contract AtomicExpiredCleanupProbe {
    IPermissionedRegistry public immutable registry;
    address public immutable owner;

    constructor(IPermissionedRegistry registry_, address owner_) {
        registry = registry_;
        owner = owner_;
    }

    function cleanup(uint256 labelId, uint256 expectedId) external {
        require(msg.sender == owner, "owner only");
        IPermissionedRegistry.State memory state = registry.getState(labelId);
        require(
            state.status == IPermissionedRegistry.Status.AVAILABLE && state.expiry != 0
                && state.expiry <= block.timestamp && state.latestOwner != address(0) && state.tokenId == expectedId,
            "not expired retained token"
        );
        registry.renew(labelId, uint64(block.timestamp + 1));
        registry.unregister(labelId);
    }
}

contract FinalArchitectureCorrectionsTest is ThreeLevelENSv2Test {
    function _registrar() internal returns (CredentialRegistrar reg) {
        reg = new CredentialRegistrar(OWNER, rootLabel, r1, r2);
        vm.prank(OWNER);
        r2.grantRootRoles(4097, address(reg));
    }

    function _assertState(string memory label, IPermissionedRegistry.Status status, uint64 expiry, address latest)
        internal
        view
    {
        uint256 labelId = LibLabel.id(label);
        IPermissionedRegistry.State memory s = r2.getState(labelId);
        assertEq(uint256(s.status), uint256(status));
        assertEq(s.expiry, expiry);
        assertEq(s.latestOwner, latest);
        assertEq(uint256(r2.getStatus(labelId)), uint256(status));
        assertEq(r2.getExpiry(labelId), expiry);
    }

    function testFinalReachableStatusExpiryCombinations() public {
        CredentialRegistrar reg = _registrar();
        uint256 labelId = LibLabel.id("initial");
        _assertState("initial", IPermissionedRegistry.Status.AVAILABLE, 0, address(0));
        assertEq(r2.getState(labelId).tokenId, LibLabel.withVersion(labelId, 0));
        assertEq(r2.getState(labelId).resource, LibLabel.withVersion(labelId, 1));
        vm.prank(OWNER);
        reg.issue("initial", GUEST, miraExpiry);
        _assertState("initial", IPermissionedRegistry.Status.REGISTERED, miraExpiry, GUEST);
        vm.prank(OWNER);
        r2.register("future-reserve", address(0), IRegistry(address(0)), address(0), 0, miraExpiry);
        _assertState("future-reserve", IPermissionedRegistry.Status.RESERVED, miraExpiry, address(0));
        // A reservation with a positive but past expiry is allowed and currently AVAILABLE.
        vm.prank(OWNER);
        r2.register("past-reserve", address(0), IRegistry(address(0)), address(0), 0, 1);
        _assertState("past-reserve", IPermissionedRegistry.Status.AVAILABLE, 1, address(0));
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.LabelAlreadyUsed.selector);
        reg.issue("past-reserve", GUEST, miraExpiry);
        vm.warp(miraExpiry);
        _assertState("initial", IPermissionedRegistry.Status.AVAILABLE, miraExpiry, GUEST);
        _assertState("future-reserve", IPermissionedRegistry.Status.AVAILABLE, miraExpiry, address(0));
    }

    function testFinalZeroExpiryUnavailableStatesAreNotReachableThroughVerifiedAPIs() public {
        vm.startPrank(OWNER);
        vm.expectRevert();
        r2.register("zero-reserve", address(0), IRegistry(address(0)), address(0), 0, 0);
        vm.expectRevert();
        r2.register("zero-active", GUEST, IRegistry(address(0)), address(0), 0, 0);
        vm.expectRevert();
        r2.renew(LibLabel.id("untouched"), 0);
        vm.expectRevert();
        r2.renew(miraToken, 0);
        vm.stopPrank();
        _assertState("zero-reserve", IPermissionedRegistry.Status.AVAILABLE, 0, address(0));
        _assertState("zero-active", IPermissionedRegistry.Status.AVAILABLE, 0, address(0));
        vm.warp(miraExpiry);
        vm.prank(OWNER);
        vm.expectRevert();
        r2.renew(miraToken, 0);
        _assertState("mira", IPermissionedRegistry.Status.AVAILABLE, miraExpiry, GUEST);
    }

    function testFinalDefensiveStatusExpiryMatrix() public {
        CredentialRegistrar reg = _registrar();
        uint256 labelId = LibLabel.id("matrix");
        // Mocked inconsistent responses are defensive guard tests, NOT observed reachable ENS states.
        for (uint256 status; status < 3; ++status) {
            for (uint256 positive; positive < 2; ++positive) {
                IPermissionedRegistry.State memory mocked = IPermissionedRegistry.State(
                    IPermissionedRegistry.Status(status),
                    positive == 0 ? 0 : miraExpiry,
                    address(0),
                    LibLabel.withVersion(labelId, 0),
                    LibLabel.withVersion(labelId, 1)
                );
                if (status == 0 && positive == 0) continue; // Real initial-state success is tested separately.
                vm.mockCall(address(r2), abi.encodeCall(r2.getState, (labelId)), abi.encode(mocked));
                vm.prank(OWNER);
                vm.expectRevert(CredentialRegistrar.LabelAlreadyUsed.selector);
                reg.issue("matrix", GUEST, miraExpiry);
                vm.clearMockedCalls();
            }
        }
    }

    function testFinalDefensiveZeroExpiryHistoryFieldsReject() public {
        CredentialRegistrar reg = _registrar();
        uint256 labelId = LibLabel.id("matrix");
        for (uint256 field; field < 3; ++field) {
            IPermissionedRegistry.State memory mocked = IPermissionedRegistry.State(
                IPermissionedRegistry.Status.AVAILABLE,
                0,
                field == 0 ? GUEST : address(0),
                LibLabel.withVersion(labelId, field == 1 ? 1 : 0),
                LibLabel.withVersion(labelId, field == 2 ? 2 : 1)
            );
            vm.mockCall(address(r2), abi.encodeCall(r2.getState, (labelId)), abi.encode(mocked));
            vm.prank(OWNER);
            vm.expectRevert(CredentialRegistrar.LabelAlreadyUsed.selector);
            reg.issue("matrix", GUEST, miraExpiry);
            vm.clearMockedCalls();
        }
    }

    function testFinalRevokedAndRenewedReservationStatesRetainUseEvidence() public {
        CredentialRegistrar reg = _registrar();
        uint256 old = miraToken;
        vm.prank(OWNER);
        r2.unregister(old);
        _assertState("mira", IPermissionedRegistry.Status.AVAILABLE, uint64(block.timestamp), address(0));
        assertTrue(r2.getState(LibLabel.id("mira")).tokenId != old);
        vm.prank(OWNER);
        r2.renew(old, miraExpiry);
        _assertState("mira", IPermissionedRegistry.Status.RESERVED, miraExpiry, address(0));
        assertFalse(_accept("mira", GUEST, door));
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.LabelAlreadyUsed.selector);
        reg.issue("mira", GUEST, miraExpiry);
    }

    function testFinalExpiredOwnershipUnregisterAndAdministrativeRevival() public {
        CredentialRegistrar reg = _registrar();
        uint256 resource = r2.getResource(miraToken);
        vm.warp(miraExpiry);
        _assertState("mira", IPermissionedRegistry.Status.AVAILABLE, miraExpiry, GUEST);
        assertEq(r2.getOwner(miraToken), address(0));
        assertEq(r2.ownerOf(miraToken), address(0));
        assertEq(r2.latestOwnerOf(miraToken), GUEST);
        assertFalse(_accept("mira", GUEST, door), "expiry alone denies access");
        vm.prank(OWNER);
        vm.expectRevert();
        r2.unregister(miraToken);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.StaleCredential.selector);
        reg.revoke("mira", miraToken);
        vm.prank(GUEST);
        vm.expectRevert();
        r2.renew(miraToken, uint64(block.timestamp + 120));
        vm.prank(OWNER);
        r2.renew(miraToken, uint64(block.timestamp + 120));
        assertEq(r2.getOwner(miraToken), GUEST);
        assertEq(r2.getState(miraToken).tokenId, miraToken);
        assertEq(r2.getResource(miraToken), resource);
        assertTrue(_accept("mira", GUEST, door), "administrative renewal revives current-state access");
        vm.prank(OWNER);
        reg.revoke("mira", miraToken);
        assertFalse(_accept("mira", GUEST, door));
        vm.prank(OWNER);
        r2.renew(miraToken, uint64(block.timestamp + 180));
        assertEq(uint256(r2.getState(miraToken).status), uint256(IPermissionedRegistry.Status.RESERVED));
        assertFalse(_accept("mira", GUEST, door), "renewing burned token does not restore guest");
    }

    function testFinalMinimalRegistrarCannotRenewExpiredCredential() public {
        CredentialRegistrar reg = _registrar();
        vm.warp(miraExpiry);
        assertFalse(r2.hasRootRoles(R.ROLE_RENEW, address(reg)));
        vm.prank(address(reg));
        vm.expectRevert();
        r2.renew(miraToken, uint64(block.timestamp + 120));
        vm.prank(OWNER);
        (bool ok,) = address(reg).call(
            abi.encodeWithSignature("renew(uint256,uint64)", miraToken, uint64(block.timestamp + 120))
        );
        assertFalse(ok, "registrar exposes no renewal forwarding");
        assertFalse(_accept("mira", GUEST, door));
    }

    function testFinalOptionalAtomicAdminCleanupBurnsExpiredResidualToken() public {
        AtomicExpiredCleanupProbe probe = new AtomicExpiredCleanupProbe(r2, OWNER);
        vm.prank(OWNER);
        r2.grantRootRoles(R.ROLE_RENEW | R.ROLE_UNREGISTER, address(probe));
        vm.warp(miraExpiry);
        vm.prank(OTHER);
        vm.expectRevert();
        probe.cleanup(LibLabel.id("mira"), miraToken);
        vm.prank(OWNER);
        probe.cleanup(LibLabel.id("mira"), miraToken);
        assertEq(r2.latestOwnerOf(miraToken), address(0));
        assertEq(r2.getOwner(miraToken), address(0));
        assertFalse(_accept("mira", GUEST, door));
        vm.prank(OWNER);
        r2.renew(miraToken, uint64(block.timestamp + 120));
        assertEq(uint256(r2.getState(miraToken).status), uint256(IPermissionedRegistry.Status.RESERVED));
        assertFalse(_accept("mira", GUEST, door));
    }

    function testFinalAdminDelegationCanDestroyRevocationGuarantee() public {
        CredentialRegistrar reg = _registrar();
        // Deliberate counterexample outside zero-root-role guest profile.
        vm.prank(OWNER);
        r2.grantRootRoles(OPERATIONS | ADMINS, GUEST);
        vm.startPrank(GUEST);
        r2.revokeRootRoles(4097, address(reg));
        r2.revokeRootRoles(OPERATIONS | ADMINS, OWNER);
        r2.revokeRootRoles(OPERATIONS | ADMINS, GUEST);
        vm.stopPrank();
        assertTrue(r2.isEmancipated());
        assertEq(r2.getOwner(miraToken), GUEST);
        vm.prank(OWNER);
        vm.expectRevert(CredentialRegistrar.InvalidPermissions.selector);
        reg.revoke("mira", miraToken);
        assertTrue(_accept("mira", GUEST, door), "emancipation does not itself revoke guest");
    }

    function testFinalRenewRemovalAndRegrantAreAdministratorChoices() public {
        vm.prank(OWNER);
        r2.revokeRootRoles(R.ROLE_RENEW, OWNER);
        vm.warp(miraExpiry);
        vm.prank(OWNER);
        vm.expectRevert();
        r2.renew(miraToken, uint64(block.timestamp + 120));
        assertFalse(_accept("mira", GUEST, door));
        vm.prank(OWNER);
        r2.grantRootRoles(R.ROLE_RENEW, OWNER);
        vm.prank(OWNER);
        r2.renew(miraToken, uint64(block.timestamp + 120));
        assertTrue(_accept("mira", GUEST, door), "retained RENEW_ADMIN can restore renewal authority");
    }

    function testFinalFactoryVerificationIdentityAndRuntimeAreSeparate() public {
        CredentialRegistrar reg = _registrar();
        assertEq(FACTORY.verifyContract(address(r1)), IMPL);
        assertEq(FACTORY.verifyContract(address(r2)), IMPL);
        assertEq(IMPL.codehash, bytes32(0xed6d71bc90b0882fa63ef78a8dddabff2730b4c1cab9eab2ad91fa2aacd269f7));
        assertEq(address(FACTORY).codehash, bytes32(0x141dc0d5ee8c60ae9b9cce12c870d3babc28719602238ee0f77016a9f1916265));
        vm.expectRevert();
        FACTORY.verifyContract(address(reg)); // Has code, but isn't a verified factory proxy.
        vm.prank(OWNER);
        uint256 id = reg.issue("verified", GUEST, miraExpiry);
        vm.prank(OWNER);
        reg.revoke("verified", id);
        assertEq(r2.getOwner(id), address(0));
        // This test makes no compiler/source-bytecode-equivalence assertion.
    }
}
