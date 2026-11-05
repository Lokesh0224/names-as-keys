// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ThreeLevelENSv2Test} from "../stage3/ThreeLevelENSv2.t.sol";

/// @notice Synthetic registration on a pinned fork only; conveys no live root ownership.
contract RegistrationRoleReadbackTest is ThreeLevelENSv2Test {
    // Derived independently from the deployment-linked ETHRegistrar/RegistryRolesLib source.
    uint256 constant DEPLOYED_REGISTRATION_BITMAP = 97409655027181761882228017414928043058140282880;
    uint256 constant LOCK_BITMAP = 91700664256357922357994873537130062512592519168;

    function testStage3ERegistrationAndInitializationRoleReadback() public {
        emit log_named_uint("observed root registration role bitmap", ETH.roles(ETH.getResource(rootToken), OWNER));
        emit log_named_uint("observed R1 initialization role bitmap", r1.roles(r1.ROOT_RESOURCE(), OWNER));
        emit log_named_uint("observed lock token role bitmap", r1.roles(r1.getResource(lockToken), OWNER));
        assertEq(ETH.roles(ETH.getResource(rootToken), OWNER), DEPLOYED_REGISTRATION_BITMAP);
        assertEq(r1.roles(r1.ROOT_RESOURCE(), OWNER), OPERATIONS | ADMINS);
        assertEq(r2.roles(r2.ROOT_RESOURCE(), OWNER), OPERATIONS | ADMINS);
        assertEq(r1.roles(r1.getResource(lockToken), OWNER), LOCK_BITMAP);
        assertEq(r2.roleCount(r2.getResource(miraToken)), 0);
        assertNotEq(keccak256(bytes(rootLabel)), keccak256("nak-lokesh-20261105"));
    }
}
