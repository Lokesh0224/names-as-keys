// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {IETHRegistrar} from "../../src/ens-vendored/registrar/interfaces/IETHRegistrar.sol";
import {IETHRenewer} from "../../src/ens-vendored/registrar/interfaces/IETHRenewer.sol";
import {IRegistry} from "../../src/ens-vendored/registry/interfaces/IRegistry.sol";
import {IPermissionedRegistry} from "../../src/ens-vendored/registry/interfaces/IPermissionedRegistry.sol";
import {IVerifiableFactory} from "../../src/ens-vendored/verifiable-factory/IVerifiableFactory.sol";
import {Grant} from "../../src/ens-vendored/access-control/interfaces/IEACGrantInitializable.sol";
import {IAddressSetter} from "../../src/ens-vendored/resolver/interfaces/setters/IAddressSetter.sol";
import {IUnsafeTransferable} from "../../src/ens-vendored/utils/interfaces/IUnsafeTransferable.sol";
import {IPermissionedResolverInitializable} from "../../src/ens-vendored/resolver/interfaces/IPermissionedResolverInitializable.sol";
import {IUniversalResolver} from "../../src/ens-vendored/interfaces/IUniversalResolver.sol";
import {SpikeRegistrar} from "../../src/spike/SpikeRegistrar.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMockERC20} from "../../src/ens-vendored/oz/IMockERC20.sol";

/// @notice End-to-end probes against the current Sepolia ENSv2 fork.
/// Run via scripts/run-spike.sh. Tests deliberately assert the behavior needed
/// by Names as Keys; unexpected reverts are evidence and should not be skipped.
contract ENSv2QuestionsTest is Test {
    address internal constant ETH_REGISTRY = 0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4;
    address internal constant ETH_REGISTRAR = 0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3;
    address internal constant FACTORY = 0xDa70306C98E97eCe36F997a21368e53298572991;
    address internal constant USER_IMPL = 0x9BD8a88719068D09ecee662f36C0E3856708366a;
    address internal constant PERMISSIONED_RESOLVER_IMPL = 0x115eb53F0c60696633855F90b138178Fb40b2b2C;
    address internal constant PUBLIC_RESOLVER = 0xdC4a563d00F5c3012b699794eB9e13A561Be386F;
    address internal constant UR = 0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe;
    address internal constant MOCK_USDC = 0x240b0316Df57887DBBE58b586508b19e633a14aa;
    address internal constant MOCK_DAI = 0xF6faC8A58a0BE13b9197f27C41B73162Fe32572b;

    uint256 internal constant ROLE_REGISTRAR = 1 << 0;
    uint256 internal constant ROLE_UNREGISTER = 1 << 12;
    uint256 internal constant ROLE_RENEW = 1 << 16;
    uint256 internal constant ROLE_SET_SUBREGISTRY = 1 << 20;
    uint256 internal constant ROLE_SET_RESOLVER = 1 << 24;
    uint256 internal constant ROLE_UPGRADE = 1 << 124;
    uint256 internal constant ROLE_SET_ADDRESS = 1 << 0;
    uint256 internal constant ROLE_REGISTRAR_ADMIN = ROLE_REGISTRAR << 128;
    uint256 internal constant ROLE_UNREGISTER_ADMIN = ROLE_UNREGISTER << 128;
    uint256 internal constant ROLE_RENEW_ADMIN = ROLE_RENEW << 128;
    uint256 internal constant ROLE_SET_SUBREGISTRY_ADMIN = ROLE_SET_SUBREGISTRY << 128;
    uint256 internal constant ROLE_SET_RESOLVER_ADMIN = ROLE_SET_RESOLVER << 128;
    uint256 internal constant ROLE_UPGRADE_ADMIN = ROLE_UPGRADE << 128;
    uint64 internal constant PARENT_DURATION = 365 days;

    address internal owner = address(0xA11CE);
    address internal guest = address(0xB0B);
    address internal stranger = address(0xCAFE);
    IPermissionedRegistry internal subregistry;
    SpikeRegistrar internal spikeRegistrar;
    string internal parentLabel;
    uint256 internal parentTokenId;
    uint64 internal parentExpiry;
    IERC20 internal paymentToken;

    event Probe(string key, uint256 value);
    event ProbeAddress(string key, address value);
    event ProbeText(string key, string value);

    function _freshLabel(string memory prefix) internal view returns (string memory) {
        return string.concat(prefix, vm.toString(uint256(keccak256(abi.encode(block.number, block.timestamp, address(this)))) % 1e12));
    }

    function _registerParent() internal {
        IETHRegistrar registrar = IETHRegistrar(ETH_REGISTRAR);
        parentLabel = _freshLabel("spike");
        bytes32 secret = keccak256(abi.encode(blockhash(block.number - 1), parentLabel, address(this)));
        bytes32 referrer;
        address[2] memory tokens = [MOCK_USDC, MOCK_DAI];
        for (uint256 i; i < tokens.length; ++i) {
            try registrar.getRegisterPrice(parentLabel, PARENT_DURATION, IERC20(tokens[i])) returns (uint256 b, uint256 p) {
                console2.log("Q1_acceptedPaymentToken", tokens[i]);
                console2.log("Q1_priceBase", b);
                console2.log("Q1_pricePremium", p);
            } catch { console2.log("Q1_paymentTokenRejected", tokens[i]); }
        }
        uint256 base;
        uint256 premium;
        bool found;
        for (uint256 i; i < tokens.length; ++i) {
            try registrar.getRegisterPrice(parentLabel, PARENT_DURATION, IERC20(tokens[i])) returns (uint256 b, uint256 p) {
                paymentToken = IERC20(tokens[i]);
                base = b;
                premium = p;
                found = true;
                break;
            } catch {}
        }
        require(found, "neither manifest mock token accepted");
        emit ProbeAddress("acceptedPaymentToken", address(paymentToken));
        emit Probe("parentBasePrice", base);
        emit Probe("parentPremium", premium);
        emit Probe("parentDuration", PARENT_DURATION);
        console2.log("parentLabel", parentLabel);
        console2.log("acceptedPaymentToken", address(paymentToken));
        console2.log("parentBasePrice", base);
        console2.log("parentPremium", premium);
        console2.log("parentDuration", uint256(PARENT_DURATION));
        assertTrue(registrar.isAvailable(parentLabel), "fresh label unavailable");

        bytes32 commitment = registrar.makeCommitment(
            parentLabel, owner, secret, IRegistry(address(0)), PUBLIC_RESOLVER, PARENT_DURATION, referrer
        );
        registrar.commit(commitment);
        vm.warp(block.timestamp + 61);
        IMockERC20(address(paymentToken)).mint(address(this), base + premium + 1);
        paymentToken.approve(ETH_REGISTRAR, base + premium + 1);
        uint256 beforeGas = gasleft();
        parentTokenId = registrar.register(
            parentLabel, owner, secret, IRegistry(address(0)), PUBLIC_RESOLVER, PARENT_DURATION, paymentToken, referrer
        );
        uint256 parentRegisterGas = beforeGas - gasleft();
        emit Probe("gasRegisterParentInternal", parentRegisterGas);
        parentExpiry = IPermissionedRegistry(ETH_REGISTRY).getExpiry(parentTokenId);
        assertEq(IPermissionedRegistry(ETH_REGISTRY).getOwner(parentTokenId), owner);
        emit Probe("parentTokenId", parentTokenId);
        emit Probe("parentExpiry", parentExpiry);
        console2.log("parentRegisterGas", parentRegisterGas);
        console2.log("parentTokenId", parentTokenId);
    }

    function _reregisterParentAs(address newOwner) internal returns (uint256 newTokenId) {
        IETHRegistrar registrar = IETHRegistrar(ETH_REGISTRAR);
        bytes32 secret = keccak256(abi.encode(blockhash(block.number - 1), parentLabel, newOwner, block.timestamp));
        uint256 base;
        uint256 premium;
        bool found;
        address[2] memory tokens = [MOCK_USDC, MOCK_DAI];
        for (uint256 i; i < tokens.length; ++i) {
            try registrar.getRegisterPrice(parentLabel, PARENT_DURATION, IERC20(tokens[i])) returns (uint256 b, uint256 p) {
                paymentToken = IERC20(tokens[i]); base = b; premium = p; found = true; break;
            } catch {}
        }
        require(found, "no re-registration payment token accepted");
        bytes32 commitment = registrar.makeCommitment(
            parentLabel, newOwner, secret, IRegistry(address(0)), PUBLIC_RESOLVER, PARENT_DURATION, bytes32(0)
        );
        registrar.commit(commitment);
        vm.warp(block.timestamp + 61);
        IMockERC20(address(paymentToken)).mint(address(this), base + premium + 1);
        paymentToken.approve(ETH_REGISTRAR, base + premium + 1);
        newTokenId = registrar.register(
            parentLabel, newOwner, secret, IRegistry(address(0)), PUBLIC_RESOLVER, PARENT_DURATION,
            paymentToken, bytes32(0)
        );
    }

    function _setupSubregistry() internal {
        _registerParent();
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant({
            account: owner,
            roleBitmap: ROLE_REGISTRAR | ROLE_UNREGISTER | ROLE_RENEW | ROLE_SET_SUBREGISTRY
                | ROLE_SET_RESOLVER | ROLE_UPGRADE | ROLE_REGISTRAR_ADMIN | ROLE_UNREGISTER_ADMIN
                | ROLE_RENEW_ADMIN | ROLE_SET_SUBREGISTRY_ADMIN | ROLE_SET_RESOLVER_ADMIN | ROLE_UPGRADE_ADMIN
        });
        bytes memory initData = abi.encodeWithSignature("initialize((address,uint256)[])", grants);
        uint256 salt = uint256(keccak256(abi.encode(parentLabel, address(this), block.timestamp)));
        uint256 factoryGas = gasleft();
        address proxy = IVerifiableFactory(FACTORY).deployProxy(USER_IMPL, salt, initData);
        uint256 deployProxyGas = factoryGas - gasleft();
        emit Probe("gasDeployProxy", deployProxyGas);
        console2.log("deployProxyGas", deployProxyGas);
        subregistry = IPermissionedRegistry(proxy);
        assertEq(IVerifiableFactory(FACTORY).verifyContract(proxy), USER_IMPL);

        vm.prank(owner);
        uint256 parentGas = gasleft();
        IPermissionedRegistry(ETH_REGISTRY).setSubregistry(parentTokenId, IRegistry(proxy));
        uint256 setSubregistryGas = parentGas - gasleft();
        emit Probe("gasSetSubregistry", setSubregistryGas);
        console2.log("setSubregistryGas", setSubregistryGas);

        spikeRegistrar = new SpikeRegistrar(subregistry, address(0), IPermissionedRegistry(ETH_REGISTRY), parentLabel, owner);
        vm.prank(owner);
        subregistry.grantRootRoles(ROLE_REGISTRAR | ROLE_UNREGISTER, address(spikeRegistrar));
        uint256 root = subregistry.ROOT_RESOURCE();
        assertTrue(subregistry.hasRoles(root, ROLE_REGISTRAR | ROLE_UNREGISTER, address(spikeRegistrar)));
        assertFalse(subregistry.hasRoles(root, ROLE_REGISTRAR_ADMIN | ROLE_UNREGISTER_ADMIN, address(spikeRegistrar)));
        assertTrue(subregistry.hasRoles(root, ROLE_REGISTRAR_ADMIN | ROLE_UNREGISTER_ADMIN, owner));
        assertTrue(IPermissionedRegistry(ETH_REGISTRY).hasRoles(parentTokenId, ROLE_SET_SUBREGISTRY, owner));
        emit Probe("ownerRootAdminBitmap", subregistry.roles(root, owner));
        emit Probe("registrarRootBitmap", subregistry.roles(root, address(spikeRegistrar)));
        console2.log("ownerRootRoleBitmap", subregistry.roles(root, owner));
        console2.log("registrarRootRoleBitmap", subregistry.roles(root, address(spikeRegistrar)));
    }

    function _registerGuest(string memory label, address resolver) internal returns (uint256 tokenId, uint64 expiry) {
        if (resolver != spikeRegistrar.resolver()) {
            spikeRegistrar = new SpikeRegistrar(subregistry, resolver, IPermissionedRegistry(ETH_REGISTRY), parentLabel, owner);
            vm.prank(owner);
            subregistry.grantRootRoles(ROLE_REGISTRAR | ROLE_UNREGISTER, address(spikeRegistrar));
        }
        expiry = uint64(block.timestamp + 120);
        uint256 beforeGas = gasleft();
        tokenId = spikeRegistrar.register(label, guest, 0, expiry);
        uint256 registerSubnameGas = beforeGas - gasleft();
        emit Probe("gasRegisterSubnameInternal", registerSubnameGas);
        console2.log("registerSubnameGas", registerSubnameGas);
    }

    function testQ1_RegisterFreshParentCommitRevealAndPrice() public {
        _registerParent();
        assertEq(uint256(IPermissionedRegistry(ETH_REGISTRY).getStatus(parentTokenId)), uint256(IPermissionedRegistry.Status.REGISTERED));
        (bool minOk, bytes memory minData) = ETH_REGISTRAR.staticcall(abi.encodeWithSignature("MIN_REGISTER_DURATION()"));
        console2.log("Q1_minRegisterDurationGetter", minOk);
        if (minOk && minData.length >= 32) console2.log("Q1_minRegisterDuration", abi.decode(minData, (uint256)));
        (bool ageOk, bytes memory ageData) = ETH_REGISTRAR.staticcall(abi.encodeWithSignature("MIN_COMMITMENT_AGE()"));
        console2.log("Q1_minCommitmentAgeGetter", ageOk);
        if (ageOk && ageData.length >= 32) console2.log("Q1_minCommitmentAge", abi.decode(ageData, (uint256)));
        (bool maxAgeOk, bytes memory maxAgeData) = ETH_REGISTRAR.staticcall(abi.encodeWithSignature("MAX_COMMITMENT_AGE()"));
        console2.log("Q1_maxCommitmentAgeGetter", maxAgeOk);
        if (maxAgeOk && maxAgeData.length >= 32) console2.log("Q1_maxCommitmentAge", abi.decode(maxAgeData, (uint256)));
    }

    function testQ2_DeploySubregistryAttachAndProveRoles() public {
        _setupSubregistry();
        assertEq(address(IPermissionedRegistry(ETH_REGISTRY).getSubregistry(parentLabel)), address(subregistry));
    }

    function testQ3_RegisterMiraEmptyBitmapAndProbeResolverZero() public {
        _setupSubregistry();
        (uint256 tokenId, uint64 expiry) = _registerGuest("mira", address(0));
        assertEq(subregistry.ownerOf(tokenId), guest);
        assertEq(subregistry.roles(subregistry.getResource(tokenId), guest), 0);
        assertEq(subregistry.getExpiry(tokenId), expiry);
        console2.log("miraTokenId", tokenId);
        console2.log("miraExpiry", uint256(expiry));
        emit Probe("miraTokenId", tokenId);
        emit Probe("miraExpiry", expiry);

        // A distinct label tests the real resolver without relying on label reuse.
        SpikeRegistrar withResolver = new SpikeRegistrar(subregistry, PUBLIC_RESOLVER, IPermissionedRegistry(ETH_REGISTRY), parentLabel, owner);
        vm.prank(owner);
        subregistry.grantRootRoles(ROLE_REGISTRAR, address(withResolver));
        uint64 secondExpiry = uint64(block.timestamp + 120);
        uint256 secondId = withResolver.register("mira2", guest, 0, secondExpiry);
        assertEq(subregistry.getResolver(secondId == 0 ? "mira2" : "mira2"), PUBLIC_RESOLVER);
        emit Probe("mira2TokenId", secondId);
    }

    function testQ4_CanUnlockChecksStatusOwnerAndExpiry() public {
        _setupSubregistry();
        (uint256 tokenId,) = _registerGuest("mira", address(0));
        uint256 id = subregistry.getResource(tokenId);
        IPermissionedRegistry.State memory s = subregistry.getState(id);
        emit Probe("Q4_state", uint256(s.status));
        emit Probe("Q4_expiry", s.expiry);
        emit ProbeAddress("Q4_owner", subregistry.getOwner(id));
        assertTrue(spikeRegistrar.canUnlock("mira", guest));
        assertFalse(spikeRegistrar.canUnlock("mira", stranger));
        console2.log("Q4_status", uint256(s.status));
        console2.log("Q4_expiry", uint256(s.expiry));
        console2.log("Q4_guestOwner", subregistry.getOwner(id));
        console2.log("Q4_guestUnlock", spikeRegistrar.canUnlock("mira", guest));
        console2.log("Q4_strangerUnlock", spikeRegistrar.canUnlock("mira", stranger));
    }

    function testClosureV2ValidWrongOwnerChildExpiredAndRevoked() public {
        _setupSubregistry();
        (uint256 tokenId, uint64 expiry) = _registerGuest("validguest", address(0));
        assertTrue(tokenId != 0);
        assertTrue(spikeRegistrar.canUnlockV2("validguest", guest), "valid guest rejected");
        assertFalse(spikeRegistrar.canUnlockV2("validguest", stranger), "stranger accepted");
        vm.warp(uint256(expiry) + 1);
        assertFalse(spikeRegistrar.canUnlockV2("validguest", guest), "expired child accepted");

        // A second live child proves revocation independently of natural expiry.
        (uint256 revokedId,) = _registerGuest("revokedguest", address(0));
        // unregister requires ROLE_UNREGISTER (1 << 12) on the root or token
        // resource. The test contract has neither; the parent owner holds the
        // configured root role and is the authorized revoker for this fixture.
        uint256 revokedResource = subregistry.getResource(revokedId);
        vm.prank(owner);
        subregistry.unregister(revokedResource);
        assertFalse(spikeRegistrar.canUnlockV2("revokedguest", guest), "revoked child accepted");
    }

    function testClosureV2RejectsExpiredParentAndDetachedSubregistry() public {
        _setupSubregistry();
        (uint256 tokenId,) = _registerGuest("parentcheck", address(0));
        assertTrue(spikeRegistrar.canUnlockV2("parentcheck", guest));

        vm.prank(owner);
        IPermissionedRegistry(ETH_REGISTRY).setSubregistry(parentTokenId, IRegistry(address(0)));
        assertFalse(spikeRegistrar.canUnlockV2("parentcheck", guest), "detached registry accepted");

        // Restore attachment and test expiry independently.
        vm.prank(owner);
        IPermissionedRegistry(ETH_REGISTRY).setSubregistry(parentTokenId, IRegistry(address(subregistry)));
        vm.warp(uint256(parentExpiry) + 1);
        IPermissionedRegistry.State memory p = IPermissionedRegistry(ETH_REGISTRY).getState(parentTokenId);
        emit Probe("Closure_parentStatusAfterExpiry", uint256(p.status));
        emit ProbeAddress("Closure_parentOwnerAfterExpiry", IPermissionedRegistry(ETH_REGISTRY).getOwner(parentTokenId));
        emit Probe("Closure_parentExpiry", p.expiry);
        emit Probe("Closure_childStatusAfterParentExpiry", uint256(subregistry.getStatus(tokenId)));
        assertFalse(spikeRegistrar.canUnlockV2("parentcheck", guest), "expired parent accepted");
    }

    function testClosureV2CapsChildExpiryAtParentAndThirtyDayLimit() public {
        _setupSubregistry();
        uint64 tooLong = uint64(block.timestamp + 30 days + 1);
        (bool ok, bytes memory err) = address(spikeRegistrar).call(
            abi.encodeCall(SpikeRegistrar.register, ("toolongguest", guest, 0, tooLong))
        );
        assertFalse(ok, "child duration over 30d accepted");
        emit Probe("Closure_over30DayError", _selector(err));

        uint64 maxAllowed = uint64(block.timestamp + 30 days);
        uint256 acceptedId = spikeRegistrar.register("thirtydays", guest, 0, maxAllowed);
        assertLe(subregistry.getExpiry(acceptedId), IPermissionedRegistry(ETH_REGISTRY).getExpiry(parentTokenId));
        assertLe(subregistry.getExpiry(acceptedId), block.timestamp + 30 days);

        // Near parent expiry, a duration within the 30-day maximum can still
        // exceed the parent. This isolates the ancestor-expiry cap.
        vm.warp(uint256(parentExpiry) - 20 days);
        uint64 beyondParent = uint64(block.timestamp + 30 days);
        (ok, err) = address(spikeRegistrar).call(
            abi.encodeCall(SpikeRegistrar.register, ("pastparent", guest, 0, beyondParent))
        );
        assertFalse(ok, "child expiry beyond parent accepted");
        emit Probe("Closure_beyondParentExpiryError", _selector(err));
    }

    function testClosureA4ParentResaleAndReplacementSubregistry() public {
        _setupSubregistry();
        // Legacy behavior is separately evidenced by the preserved Q11 run:
        // a child deliberately registered past parent expiry remained REGISTERED.
        // Here wait through expiry and ENS grace, then let a second owner re-register.
        uint256 grace = IETHRenewer(ETH_REGISTRAR).GRACE_PERIOD();
        vm.warp(uint256(parentExpiry) + grace + 1);
        assertEq(uint256(IPermissionedRegistry(ETH_REGISTRY).getStatus(parentTokenId)), uint256(IPermissionedRegistry.Status.AVAILABLE));
        uint256 replacementId = _reregisterParentAs(stranger);
        parentTokenId = replacementId;

        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant({account: stranger, roleBitmap: ROLE_SET_SUBREGISTRY | ROLE_SET_SUBREGISTRY_ADMIN});
        bytes memory initData = abi.encodeWithSignature("initialize((address,uint256)[])", grants);
        address replacement = IVerifiableFactory(FACTORY).deployProxy(
            USER_IMPL, uint256(keccak256(abi.encode(parentLabel, "replacement", block.timestamp))), initData
        );
        vm.prank(stranger);
        IPermissionedRegistry(ETH_REGISTRY).setSubregistry(replacementId, IRegistry(replacement));

        uint256 parentLabelId = uint256(keccak256(bytes(parentLabel)));
        emit Probe("A4_parentStatusAfterResale", uint256(IPermissionedRegistry(ETH_REGISTRY).getStatus(parentLabelId)));
        emit ProbeAddress("A4_parentOwnerAfterResale", IPermissionedRegistry(ETH_REGISTRY).getOwner(parentLabelId));
        emit ProbeAddress("A4_attachedSubregistryAfterResale", address(IPermissionedRegistry(ETH_REGISTRY).getSubregistry(parentLabel)));
        emit ProbeAddress("A4_oldSubregistry", address(subregistry));
        emit ProbeAddress("A4_newSubregistry", replacement);
        assertEq(IPermissionedRegistry(ETH_REGISTRY).getOwner(parentLabelId), stranger);
        assertEq(address(IPermissionedRegistry(ETH_REGISTRY).getSubregistry(parentLabel)), replacement);
        assertFalse(spikeRegistrar.canUnlockV2("parentcheck", guest), "old child registry accepted after parent resale");
    }

    function testQ5_ExpiredNameFailsUnlockAndRecordRawValues() public {
        _setupSubregistry();
        (uint256 tokenId, uint64 expiry) = _registerGuest("mira", address(0));
        uint256 id = subregistry.getResource(tokenId);
        vm.warp(uint256(expiry) + 1);
        IPermissionedRegistry.State memory s = subregistry.getState(id);
        emit Probe("Q5_state", uint256(s.status));
        emit Probe("Q5_stateExpiry", s.expiry);
        emit ProbeAddress("Q5_latestOwner", s.latestOwner);
        emit ProbeAddress("Q5_getOwner", subregistry.getOwner(id));
        emit Probe("Q5_getExpiry", subregistry.getExpiry(id));
        emit Probe("Q5_remainingAfterExpiry", subregistry.findExpiry("mira"));
        assertFalse(spikeRegistrar.canUnlock("mira", guest));
        console2.log("Q5_statusAfterExpiry", uint256(s.status));
        console2.log("Q5_latestOwner", s.latestOwner);
        console2.log("Q5_getOwner", subregistry.getOwner(id));
        console2.log("Q5_getExpiry", uint256(subregistry.getExpiry(id)));
        console2.log("Q5_unlock", spikeRegistrar.canUnlock("mira", guest));
        (bool expiredReregisterOk, bytes memory expiredReregisterError) = address(spikeRegistrar).call(
            abi.encodeCall(SpikeRegistrar.register, ("mira", guest, 0, uint64(block.timestamp + 120)))
        );
        console2.log("Q5_registerAfterExpiry", expiredReregisterOk);
        if (!expiredReregisterOk) console2.log("Q5_expiredRegisterError", _selector(expiredReregisterError));
    }

    function testQ6_UnregisterAndProbeSameAndDifferentLabelReuse() public {
        _setupSubregistry();
        (uint256 tokenId,) = _registerGuest("mira", address(0));
        uint256 id = subregistry.getResource(tokenId);
        uint256 gasBefore = gasleft();
        spikeRegistrar.unregister(id);
        emit Probe("gasUnregisterInternal", gasBefore - gasleft());
        IPermissionedRegistry.State memory s = subregistry.getState(id);
        emit Probe("Q6_stateAfterUnregister", uint256(s.status));
        emit ProbeAddress("Q6_ownerAfterUnregister", subregistry.getOwner(id));
        emit Probe("Q6_expiryAfterUnregister", subregistry.getExpiry(id));
        console2.log("Q6_statusAfterUnregister", uint256(s.status));
        console2.log("Q6_ownerAfterUnregister", subregistry.getOwner(id));
        console2.log("Q6_expiryAfterUnregister", uint256(subregistry.getExpiry(id)));
        _probeReregister("mira", guest);
        _probeReregister("mira", stranger);
        uint256 other = spikeRegistrar.register("mira2", guest, 0, uint64(block.timestamp + 120));
        assertEq(subregistry.ownerOf(other), guest);
    }

    function _probeReregister(string memory label, address newOwner) internal {
        (bool ok, bytes memory ret) = address(spikeRegistrar).call(
            abi.encodeCall(SpikeRegistrar.register, (label, newOwner, 0, uint64(block.timestamp + 120)))
        );
        emit ProbeText(ok ? "reregisterSucceeded" : "reregisterRevert", label);
        if (!ok) emit Probe("reregisterErrorSelector", _selector(ret));
        console2.log(ok ? "reregisterSucceeded" : "reregisterReverted", label);
        if (!ok) console2.log("reregisterErrorSelector", _selector(ret));
    }

    function testQ7_EmptyBitmapBlocksGuestAndAllowsParentOwnerOverride() public {
        _setupSubregistry();
        (uint256 tokenId,) = _registerGuest("mira", address(0));
        uint256 id = subregistry.getResource(tokenId);
        _assertGuestCannotControl(tokenId, id);
        _assertParentOwnerCanControl(id);
        assertEq(uint256(subregistry.getStatus(id)), uint256(IPermissionedRegistry.Status.AVAILABLE));
    }

    function _assertGuestCannotControl(uint256 tokenId, uint256 id) internal {
        vm.startPrank(guest);
        (bool ok, bytes memory err) = address(subregistry).call(
            abi.encodeWithSignature("safeTransferFrom(address,address,uint256,uint256,bytes)", guest, stranger, tokenId, 1, bytes(""))
        );
        assertFalse(ok); emit Probe("Q7_transferError", _selector(err)); console2.log("Q7_transferError", _selector(err));
        uint256[] memory ids = new uint256[](1); ids[0] = tokenId;
        uint256[] memory values = new uint256[](1); values[0] = 1;
        (ok, err) = address(subregistry).call(
            abi.encodeWithSignature("safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)", guest, stranger, ids, values, bytes(""))
        );
        assertFalse(ok); emit Probe("Q7_batchTransferError", _selector(err)); console2.log("Q7_batchTransferError", _selector(err));
        (ok, err) = address(subregistry).call(
            abi.encodeCall(IUnsafeTransferable.unsafeTransfer, (stranger, tokenId, bytes("")))
        );
        assertFalse(ok); emit Probe("Q7_unsafeTransferError", _selector(err)); console2.log("Q7_unsafeTransferError", _selector(err));
        uint256[] memory unsafeIds = new uint256[](1); unsafeIds[0] = tokenId;
        (ok, err) = address(subregistry).call(
            abi.encodeCall(IUnsafeTransferable.unsafeBatchTransfer, (stranger, unsafeIds, bytes("")))
        );
        assertFalse(ok); emit Probe("Q7_unsafeBatchTransferError", _selector(err)); console2.log("Q7_unsafeBatchTransferError", _selector(err));
        (ok, err) = address(subregistry).call(abi.encodeCall(subregistry.setResolver, (id, PUBLIC_RESOLVER)));
        assertFalse(ok); emit Probe("Q7_setResolverError", _selector(err)); console2.log("Q7_setResolverError", _selector(err));
        (ok, err) = address(subregistry).call(abi.encodeCall(subregistry.setSubregistry, (id, IRegistry(address(0)))));
        assertFalse(ok); emit Probe("Q7_setSubregistryError", _selector(err)); console2.log("Q7_setSubregistryError", _selector(err));
        (ok, err) = address(subregistry).call(abi.encodeCall(subregistry.unregister, (id)));
        assertFalse(ok); emit Probe("Q7_unregisterError", _selector(err)); console2.log("Q7_unregisterError", _selector(err));
        (ok, err) = address(subregistry).call(abi.encodeCall(subregistry.renew, (id, uint64(block.timestamp + 500))));
        assertFalse(ok); emit Probe("Q7_renewError", _selector(err)); console2.log("Q7_renewError", _selector(err));
        vm.stopPrank();
    }

    function _assertParentOwnerCanControl(uint256 id) internal {
        vm.startPrank(owner);
        subregistry.setResolver(id, PUBLIC_RESOLVER);
        subregistry.setSubregistry(id, IRegistry(address(0)));
        subregistry.renew(id, uint64(block.timestamp + 500));
        subregistry.unregister(id);
        vm.stopPrank();
    }

    function testQ8_OwnerRevokesRegistrarAndRecoversDirectControl() public {
        _setupSubregistry();
        (uint256 tokenId,) = _registerGuest("mira", address(0));
        uint256 id = subregistry.getResource(tokenId);
        uint256 root = subregistry.ROOT_RESOURCE();
        vm.prank(owner);
        subregistry.revokeRootRoles(ROLE_REGISTRAR | ROLE_UNREGISTER, address(spikeRegistrar));
        assertFalse(subregistry.hasRoles(root, ROLE_REGISTRAR | ROLE_UNREGISTER, address(spikeRegistrar)));
        assertTrue(subregistry.hasRoles(root, ROLE_REGISTRAR_ADMIN | ROLE_UNREGISTER_ADMIN, owner));

        (bool regOk, bytes memory regErr) = address(spikeRegistrar).call(
            abi.encodeCall(SpikeRegistrar.register, ("afterkill", guest, 0, uint64(block.timestamp + 120)))
        );
        (bool unregOk, bytes memory unregErr) = address(spikeRegistrar).call(abi.encodeCall(SpikeRegistrar.unregister, (id)));
        assertFalse(regOk); assertFalse(unregOk);
        emit Probe("Q8_registerAfterRevocationError", _selector(regErr));
        emit Probe("Q8_unregisterAfterRevocationError", _selector(unregErr));
        vm.prank(owner);
        subregistry.unregister(id);
        assertEq(uint256(subregistry.getStatus(id)), uint256(IPermissionedRegistry.Status.AVAILABLE));
        emit Probe("Q8_ownerRecoveryProved", 1);
        console2.log("Q8_registerAfterRevocationError", _selector(regErr));
        console2.log("Q8_unregisterAfterRevocationError", _selector(unregErr));
        console2.log("Q8_ownerDirectUnregister", true);
    }

    function testQ9_SetAndForwardResolveAddressRecord() public {
        _setupSubregistry();
        Grant[] memory resolverGrants = new Grant[](1);
        resolverGrants[0] = Grant({account: owner, roleBitmap: ROLE_SET_ADDRESS | (ROLE_SET_ADDRESS << 128)});
        bytes[] memory initCalls = new bytes[](0);
        bytes memory resolverInit = abi.encodeWithSelector(
            IPermissionedResolverInitializable.initialize.selector, resolverGrants, initCalls
        );
        address permissionedResolver = IVerifiableFactory(FACTORY).deployProxy(
            PERMISSIONED_RESOLVER_IMPL,
            uint256(keccak256(abi.encode(parentLabel, "resolver", block.timestamp))),
            resolverInit
        );
        assertTrue(IPermissionedRegistry(permissionedResolver).hasRootRoles(ROLE_SET_ADDRESS, owner));
        (uint256 tokenId,) = _registerGuest("mira", permissionedResolver);
        string memory fullName = string.concat("mira.", parentLabel, ".eth");
        bytes32 node = _namehash(fullName);
        vm.prank(owner);
        IAddressSetter(permissionedResolver).setAddress(_dnsEncode(fullName), 60, abi.encodePacked(guest));
        bytes memory dnsName = _dnsEncode(fullName);
        (bytes memory result, address resolver) = IUniversalResolver(UR).resolve(
            dnsName, abi.encodeWithSignature("addr(bytes32)", node)
        );
        address decoded = abi.decode(result, (address));
        assertEq(resolver, permissionedResolver);
        assertEq(decoded, guest);
        emit Probe("Q9_tokenId", tokenId);
        emit ProbeAddress("Q9_resolver", resolver);
        emit ProbeAddress("Q9_resolvedAddress", decoded);
        console2.log("Q9_resolver", resolver);
        console2.log("Q9_resolvedAddress", decoded);
    }

    function testQ10_LogGasForOperationsAndUnlockView() public {
        _setupSubregistry();
        (uint256 tokenId,) = _registerGuest("mira", address(0));
        uint256 beforeGas = gasleft();
        bool can = spikeRegistrar.canUnlock("mira", guest);
        uint256 canUnlockGas = beforeGas - gasleft();
        emit Probe("gasCanUnlockInternal", canUnlockGas);
        console2.log("canUnlockGas", canUnlockGas);
        assertTrue(can);
        uint256 id = subregistry.getResource(tokenId);
        beforeGas = gasleft();
        spikeRegistrar.unregister(id);
        uint256 unregisterSubnameGas = beforeGas - gasleft();
        emit Probe("gasUnregisterInternal", unregisterSubnameGas);
        console2.log("unregisterSubnameGas", unregisterSubnameGas);
    }

    function testQ11_ObserveEventsExpiryAndLabelValidation() public {
        _setupSubregistry();
        vm.recordLogs();
        (uint256 tokenId,) = _registerGuest("mira", address(0));
        _logTopics(vm.getRecordedLogs(), "Q11_registerTopic0");
        uint64 expiry = subregistry.getExpiry(tokenId);
        emit Probe("Q11_expiry", expiry);
        uint256 tokenResource = subregistry.getResource(tokenId);
        vm.recordLogs();
        vm.prank(owner);
        subregistry.renew(tokenResource, uint64(expiry + 300));
        _logTopics(vm.getRecordedLogs(), "Q11_renewTopic0");
        emit Probe("Q11_expiryAfterRenew", subregistry.getExpiry(tokenId));
        _probeLabels();
        _probeExpiryRules();
        _probeParentExpiryAndUnregister(tokenResource);
    }

    function _logTopics(Vm.Log[] memory logs, string memory key) internal {
        for (uint256 i; i < logs.length; ++i) {
            emit Probe(key, uint256(logs[i].topics[0]));
            console2.log(key); console2.logBytes32(logs[i].topics[0]);
        }
    }

    function _probeLabels() internal {
        (bool uppercaseOk, bytes memory uppercaseError) = address(spikeRegistrar).call(
            abi.encodeCall(SpikeRegistrar.register, ("MiRa", guest, 0, uint64(block.timestamp + 120)))
        );
        emit Probe("Q11_uppercaseAccepted", uppercaseOk ? 1 : 0);
        if (!uppercaseOk) emit Probe("Q11_uppercaseError", _selector(uppercaseError));
        (bool longOk, bytes memory longError) = address(spikeRegistrar).call(
            abi.encodeCall(SpikeRegistrar.register, (string(new bytes(256)), guest, 0, uint64(block.timestamp + 120)))
        );
        emit Probe("Q11_256ByteLabelAccepted", longOk ? 1 : 0);
        if (!longOk) emit Probe("Q11_longLabelError", _selector(longError));
        if (!longOk) console2.logBytes(longError);
        (bool punctuationOk, bytes memory punctuationError) = address(spikeRegistrar).call(
            abi.encodeCall(SpikeRegistrar.register, ("mira!", guest, 0, uint64(block.timestamp + 120)))
        );
        emit Probe("Q11_punctuationLabelAccepted", punctuationOk ? 1 : 0);
        if (!punctuationOk) { emit Probe("Q11_punctuationError", _selector(punctuationError)); console2.logBytes(punctuationError); }
    }

    function _probeExpiryRules() internal {
        (bool pastOk, bytes memory pastError) = address(spikeRegistrar).call(
            abi.encodeCall(SpikeRegistrar.register, ("pastlabel", guest, 0, uint64(block.timestamp)))
        );
        emit Probe("Q11_nowExpiryAccepted", pastOk ? 1 : 0);
        if (!pastOk) emit Probe("Q11_nowExpiryError", _selector(pastError));
        if (!pastOk) console2.logBytes(pastError);
        (bool oneSecondOk, bytes memory oneSecondError) = address(spikeRegistrar).call(
            abi.encodeCall(SpikeRegistrar.register, ("one-second", guest, 0, uint64(block.timestamp + 1)))
        );
        emit Probe("Q11_oneSecondExpiryAccepted", oneSecondOk ? 1 : 0);
        if (!oneSecondOk) { emit Probe("Q11_oneSecondExpiryError", _selector(oneSecondError)); console2.logBytes(oneSecondError); }
    }

    function _probeParentExpiryAndUnregister(uint256 tokenResource) internal {
        (bool parentBoundOk, bytes memory parentBoundError) = address(spikeRegistrar).call(
            abi.encodeCall(SpikeRegistrar.register, ("parentbound", guest, 0, uint64(parentExpiry + PARENT_DURATION)))
        );
        emit Probe("Q11_beyondParentExpiryAccepted", parentBoundOk ? 1 : 0);
        if (!parentBoundOk) emit Probe("Q11_parentBoundError", _selector(parentBoundError));
        vm.recordLogs();
        spikeRegistrar.unregister(tokenResource);
        _logTopics(vm.getRecordedLogs(), "Q11_unregisterTopic0");
        vm.warp(uint256(parentExpiry) + 1);
        uint256 parentBoundId = subregistry.findTokenId("parentbound");
        emit Probe("Q11_parentStateAfterExpiry", uint256(IPermissionedRegistry(ETH_REGISTRY).getStatus(parentTokenId)));
        emit Probe("Q11_childStateAfterParentExpiry", uint256(subregistry.getStatus(parentBoundId)));
        emit Probe("Q11_parentExpiryUnlock", spikeRegistrar.canUnlock("parentbound", guest) ? 1 : 0);
        console2.log("Q11_parentStateAfterExpiry", uint256(IPermissionedRegistry(ETH_REGISTRY).getStatus(parentTokenId)));
        console2.log("Q11_childStateAfterParentExpiry", uint256(subregistry.getStatus(parentBoundId)));
        console2.log("Q11_parentExpiryUnlock", spikeRegistrar.canUnlock("parentbound", guest));
        assertFalse(spikeRegistrar.canUnlock("parentbound", guest));
    }

    function _selector(bytes memory data) internal pure returns (uint256 s) {
        if (data.length >= 4) assembly { s := shr(224, mload(add(data, 32))) }
    }

    function _namehash(string memory name) internal pure returns (bytes32 node) {
        bytes memory n = bytes(name);
        uint256 end = n.length;
        while (end > 0) {
            uint256 start = end;
            while (start > 0 && n[start - 1] != ".") --start;
            bytes32 labelHash;
            assembly { labelHash := keccak256(add(add(n, 32), start), sub(end, start)) }
            node = keccak256(abi.encodePacked(node, labelHash));
            if (start == 0) break;
            end = start - 1;
        }
    }

    function _dnsEncode(string memory name) internal pure returns (bytes memory out) {
        bytes memory n = bytes(name);
        uint256 start;
        for (uint256 i; i <= n.length; ++i) {
            if (i == n.length || n[i] == ".") {
                uint256 len = i - start;
                bytes memory label = new bytes(len);
                for (uint256 j; j < len; ++j) label[j] = n[start + j];
                out = bytes.concat(out, bytes1(uint8(len)), label);
                start = i + 1;
            }
        }
        out = bytes.concat(out, bytes1(0));
    }
}
