// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {IUniversalResolver} from "../../src/ens-vendored/interfaces/IUniversalResolver.sol";

/// @notice Read-only fork sanity checks. Run with:
/// forge test --match-contract SepoliaDeploymentSmokeTest --fork-url https://ethereum-sepolia-rpc.publicnode.com -vv
contract SepoliaDeploymentSmokeTest is Test {
    address internal constant ETH_REGISTRY = 0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4;
    address internal constant ETH_REGISTRAR = 0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3;
    address internal constant UR = 0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe;
    address internal constant FACTORY = 0xDa70306C98E97eCe36F997a21368e53298572991;
    address internal constant USER_REGISTRY_IMPL = 0x9BD8a88719068D09ecee662f36C0E3856708366a;
    address internal constant PERMISSIONED_RESOLVER_IMPL = 0x115eb53F0c60696633855F90b138178Fb40b2b2C;

    function testSepoliaENSv2DeploymentHasCode() public view {
        assertEq(block.chainid, 11155111, "not Sepolia");
        assertGt(ETH_REGISTRY.code.length, 0, "ETHRegistry missing");
        assertGt(ETH_REGISTRAR.code.length, 0, "ETHRegistrar missing");
        assertGt(UR.code.length, 0, "Universal Resolver missing");
        assertGt(FACTORY.code.length, 0, "VerifiableFactory missing");
        assertGt(USER_REGISTRY_IMPL.code.length, 0, "UserRegistry implementation missing");
        assertGt(PERMISSIONED_RESOLVER_IMPL.code.length, 0, "PermissionedResolver implementation missing");
    }

    function testUniversalResolverReportsENSv2() public view {
        assertTrue(IUniversalResolver(UR).isENSv2());
    }
}
