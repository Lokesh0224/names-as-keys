// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ENSv2QuestionsTest} from "./ENSv2Questions.t.sol";
import {console2} from "forge-std/console2.sol";
import {IUnsafeTransferable} from "../../src/ens-vendored/utils/interfaces/IUnsafeTransferable.sol";

/// @notice Five source-directed transfer probes for the supplied A3-lite scope.
/// @dev Inherits the existing fork fixture without changing it. Run only the
///      A3-lite test names when selecting this file because fixture test methods
///      are inherited as well.
contract ClosureA3LiteTest is ENSv2QuestionsTest {
    // Vendored RegistryRolesLib.sol:45 defines this role as
    // (1 << 28) << 128, i.e. bit 156.
    uint256 internal constant ROLE_CAN_TRANSFER_ADMIN = uint256(1) << 156;

    function testA3LiteControlTransferCapableUnsafeSucceeds() public {
        _setupSubregistry();
        uint64 expiry = uint64(block.timestamp + 120);
        uint256 tokenId = spikeRegistrar.register(
            "controltransfer", guest, ROLE_CAN_TRANSFER_ADMIN, expiry
        );
        uint256 resource = subregistry.getResource(tokenId);
        uint256 bitmap = subregistry.roles(resource, guest);

        vm.prank(guest);
        (bool ok, bytes memory result) = address(subregistry).call(
            abi.encodeCall(IUnsafeTransferable.unsafeTransfer, (stranger, tokenId, bytes("")))
        );
        console2.log("A3LITE_CONTROL_SOURCE_PREDICTED_SUCCESS", true);
        console2.log("A3LITE_CONTROL_TOKEN_BITMAP", bitmap);
        console2.log("A3LITE_CONTROL_OBSERVED_SUCCESS", ok);
        console2.log("A3LITE_CONTROL_OBSERVED_SELECTOR_DECIMAL", _selector(result));
        assertEq(bitmap, ROLE_CAN_TRANSFER_ADMIN, "control token did not retain transfer-capable bitmap");
        assertTrue(ok, "A3-lite control: transfer-capable unsafe transfer must succeed");
        assertEq(subregistry.ownerOf(tokenId), stranger, "control transfer did not change owner");
    }

    function testA3LiteEmptyBitmapUnsafeSingleReverts() public {
        (uint256 tokenId, uint256 resource) = _registerEmpty("emptyunsafe");
        vm.prank(guest);
        (bool ok, bytes memory result) = address(subregistry).call(
            abi.encodeCall(IUnsafeTransferable.unsafeTransfer, (stranger, tokenId, bytes("")))
        );
        uint256 observedSelector = _selector(result);
        console2.log("A3LITE_EMPTY_UNSAFE_SOURCE_PREDICTED_REVERT", true);
        console2.log("A3LITE_EMPTY_UNSAFE_SOURCE_PREDICTED_SELECTOR", uint256(uint32(0xe58f6d5a)));
        console2.log("A3LITE_EMPTY_UNSAFE_OBSERVED_SUCCESS", ok);
        console2.log("A3LITE_EMPTY_UNSAFE_OBSERVED_SELECTOR_DECIMAL", observedSelector);
        console2.log("A3LITE_EMPTY_UNSAFE_RESOURCE_BITMAP", subregistry.roles(resource, guest));
        assertFalse(ok, "A3-lite empty-bitmap unsafe transfer unexpectedly succeeded");
        assertEq(observedSelector, uint256(uint32(0xe58f6d5a)), "unexpected unsafe transfer selector");
    }

    function testA3LiteEmptyBitmapSafeSingleReverts() public {
        (uint256 tokenId, uint256 resource) = _registerEmpty("emptysafetransfer");
        vm.prank(guest);
        (bool ok, bytes memory result) = address(subregistry).call(
            abi.encodeWithSignature(
                "safeTransferFrom(address,address,uint256,uint256,bytes)",
                guest,
                stranger,
                tokenId,
                1,
                bytes("")
            )
        );
        uint256 observedSelector = _selector(result);
        console2.log("A3LITE_EMPTY_SAFE_SOURCE_PREDICTED_REVERT", true);
        console2.log("A3LITE_EMPTY_SAFE_SOURCE_PREDICTED_SELECTOR", uint256(uint32(0x54838f98)));
        console2.log("A3LITE_EMPTY_SAFE_OBSERVED_SUCCESS", ok);
        console2.log("A3LITE_EMPTY_SAFE_OBSERVED_SELECTOR_DECIMAL", observedSelector);
        console2.log("A3LITE_EMPTY_SAFE_RESOURCE_BITMAP", subregistry.roles(resource, guest));
        assertFalse(ok, "A3-lite empty-bitmap safe transfer unexpectedly succeeded");
        assertEq(observedSelector, uint256(uint32(0x54838f98)), "unexpected safe transfer selector");
    }

    function testA3LiteIsEmancipatedFalseInFixtureSetup() public {
        _setupSubregistry();
        bool observed = subregistry.isEmancipated();
        console2.log("A3LITE_EMANCIPATION_SOURCE_PREDICTED", false);
        console2.log("A3LITE_EMANCIPATION_OBSERVED", observed);
        console2.log("A3LITE_OWNER_ROOT_BITMAP", subregistry.roles(subregistry.ROOT_RESOURCE(), owner));
        console2.log("A3LITE_REGISTRAR_ROOT_BITMAP", subregistry.roles(subregistry.ROOT_RESOURCE(), address(spikeRegistrar)));
        assertFalse(observed, "A3-lite fixture unexpectedly emancipated");
    }

    function testA3LiteEmptyBitmapGuestSelfGrantReverts() public {
        (uint256 tokenId, uint256 resource) = _registerEmpty("emptyselfgrant");
        vm.prank(guest);
        (bool ok, bytes memory result) = address(subregistry).call(
            abi.encodeCall(subregistry.grantRoles, (resource, ROLE_CAN_TRANSFER_ADMIN, guest))
        );
        console2.log("A3LITE_SELF_GRANT_SOURCE_PREDICTED_REVERT", true);
        console2.log("A3LITE_SELF_GRANT_OBSERVED_SUCCESS", ok);
        console2.log("A3LITE_SELF_GRANT_OBSERVED_SELECTOR_DECIMAL", _selector(result));
        console2.log("A3LITE_SELF_GRANT_RESOURCE", resource);
        console2.log("A3LITE_SELF_GRANT_TOKEN_ID", tokenId);
        assertFalse(ok, "A3-lite guest self-grant unexpectedly succeeded");
    }

    function _registerEmpty(string memory label) internal returns (uint256 tokenId, uint256 resource) {
        _setupSubregistry();
        (tokenId,) = _registerGuest(label, address(0));
        resource = subregistry.getResource(tokenId);
        assertEq(subregistry.roles(resource, guest), 0, "fixture did not create an empty token bitmap");
    }
}
