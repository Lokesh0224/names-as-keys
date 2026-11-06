// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {IRegistry} from "../../src/ens-vendored/registry/interfaces/IRegistry.sol";
import {IPermissionedRegistry} from "../../src/ens-vendored/registry/interfaces/IPermissionedRegistry.sol";
import {IETHRegistrar} from "../../src/ens-vendored/registrar/interfaces/IETHRegistrar.sol";
import {IVerifiableFactory} from "../../src/ens-vendored/verifiable-factory/IVerifiableFactory.sol";
import {Grant} from "../../src/ens-vendored/access-control/interfaces/IEACGrantInitializable.sol";
import {IMockERC20} from "../../src/ens-vendored/oz/IMockERC20.sol";
import {IERC20} from "../../src/ens-vendored/oz/IERC20.sol";
import {LibLabel} from "../../src/ens-vendored/utils/LibLabel.sol";
import {CredentialRegistrar} from "../../src/CredentialRegistrar.sol";
import {DoorKeys} from "../../src/DoorKeys.sol";

interface IWorkflowTiming {
    function MIN_COMMITMENT_AGE() external view returns (uint64);
}

interface IWorkflowLabelStore {
    function getLabel(uint256 id) external view returns (string memory);
}

/// @notice TEST ONLY: disposable ordered EVM calls, not the final deployment simulation.
/// @dev No broadcast API, external transactions, wallet or signing. Pinned Sepolia read-only fork.
contract OrderedDeploymentWorkflowTest is Test {
    IPermissionedRegistry constant ETH = IPermissionedRegistry(0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4);
    IRegistry constant ROOT = IRegistry(0xB458D6a3a77919449d03e7A6903C26827c1eC43f);
    IETHRegistrar constant REG = IETHRegistrar(0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3);
    IVerifiableFactory constant FACTORY = IVerifiableFactory(0xDa70306C98E97eCe36F997a21368e53298572991);
    address constant IMPL = 0x9BD8a88719068D09ecee662f36C0E3856708366a;
    address constant LABEL_STORE = address(bytes20(hex"ed8246ff02203a4d4cb262bd78beaa7408a57cae"));
    IMockERC20 constant USDC = IMockERC20(0x240b0316Df57887DBBE58b586508b19e633a14aa);
    address constant OWNER = address(0xA11CE); // TEST ONLY, not selected live owner.
    address constant GUEST = address(0xB0B); // TEST ONLY, not selected live Mira.
    uint256 constant GRANTS = 380593917518227438537563280301172632627253505;
    uint256 constant LOCK_ROLES = 91700664256357922357994873537130062512592519168;
    uint256 constant ROOT_ROLES = 97409655027181761882228017414928043058140282880;
    bytes32 constant TEST_SECRET = keccak256("PUBLIC TEST ONLY PREIMAGE, NEVER USE LIVE");
    uint256 constant R1_SALT = 31001; // TEST ONLY, not proposed deployment salts.
    uint256 constant R2_SALT = 31002;
    string rootLabel;
    IPermissionedRegistry r1;
    IPermissionedRegistry r2;
    CredentialRegistrar registrar;
    DoorKeys door;
    uint256 rootToken;
    uint256 lockToken;
    uint256 guestToken;
    uint256 price;
    bytes32 commitment;
    uint64 lockExpiry;
    uint64 guestExpiry;
    uint256 completed;

    function setUp() public {
        assertEq(block.chainid, 11155111);
        assertEq(block.number, 12071963, "requires audit-pinned fork");
        rootLabel = "nak-workflow-test-12071963";
        assertTrue(REG.isAvailable(rootLabel), "synthetic test root collision");
        assertNotEq(keccak256(bytes(rootLabel)), keccak256("nak-lokesh-20261105"));
        assertEq(OWNER.code.length, 0);
        assertEq(GUEST.code.length, 0);
        assertEq(bytes(IWorkflowLabelStore(LABEL_STORE).getLabel(LibLabel.id(rootLabel))).length, 0);
        assertEq(bytes(IWorkflowLabelStore(LABEL_STORE).getLabel(LibLabel.id("lock"))).length, 0);
        assertEq(bytes(IWorkflowLabelStore(LABEL_STORE).getLabel(LibLabel.id("mira"))).length, 0);
    }

    function testTestOnlyOrderedFifteenActionsAndHierarchy() public {
        vm.recordLogs();
        _registration();
        _registries();
        _products();
        assertEq(completed, 15);
        assertEq(address(ROOT.getSubregistry("eth")), address(ETH));
        assertEq(address(ETH.getSubregistry(rootLabel)), address(r1));
        assertEq(address(r1.getSubregistry("lock")), address(r2));
        (IRegistry p1, string memory l1) = r1.getParent();
        (IRegistry p2, string memory l2) = r2.getParent();
        assertEq(address(p1), address(ETH));
        assertEq(l1, rootLabel);
        assertEq(address(p2), address(r1));
        assertEq(l2, "lock");
        assertEq(ETH.getState(LibLabel.id(rootLabel)).tokenId, rootToken);
        assertEq(r1.getState(LibLabel.id("lock")).tokenId, lockToken);
        assertEq(registrar.rootTokenId(), door.rootTokenId());
        assertEq(registrar.lockTokenId(), door.lockTokenId());
        assertEq(door.administrator(), OWNER);
        assertEq(door.requestNonce(), 0);
        assertEq(r2.roles(r2.ROOT_RESOURCE(), address(door)), 0);
        assertEq(r2.roles(r2.ROOT_RESOURCE(), GUEST), 0);
        assertEq(r2.roleCount(r2.getResource(guestToken)), 0);
        assertEq(r2.getOwner(guestToken), GUEST);
        assertEq(r2.getExpiry(guestToken), guestExpiry);
        assertLe(guestExpiry, lockExpiry);
        assertLe(lockExpiry, ETH.getExpiry(rootToken));
        assertFalse(r2.isEmancipated());
        assertEq(ETH.getOwner(rootToken), OWNER);
        assertEq(r1.getOwner(lockToken), OWNER);
        console2.log("TEST ONLY: 15 ordered EVM actions, exact log sequences and complete hierarchy verified");
        console2.log("NOT final deployment simulation; no live ownership, transactions or receipts created");
    }

    function _registration() internal {
        (uint256 base, uint256 premium) = REG.getRegisterPrice(rootLabel, 365 days, IERC20(address(USDC)));
        price = base + premium;
        vm.prank(OWNER);
        USDC.mint(OWNER, price);
        _step(1);
        assertEq(USDC.balanceOf(OWNER), price);
        vm.prank(OWNER);
        USDC.approve(address(REG), price);
        _step(2);
        assertEq(USDC.allowance(OWNER, address(REG)), price);
        commitment = REG.makeCommitment(rootLabel, OWNER, TEST_SECRET, IRegistry(address(0)), address(0), 365 days, 0);
        vm.prank(OWNER);
        REG.commit(commitment);
        _step(3);
        vm.warp(block.timestamp + IWorkflowTiming(address(REG)).MIN_COMMITMENT_AGE() + 1);
        vm.prank(OWNER);
        rootToken = REG.register(
            rootLabel, OWNER, TEST_SECRET, IRegistry(address(0)), address(0), 365 days, IERC20(address(USDC)), 0
        );
        _step(4);
        assertEq(ETH.getOwner(rootToken), OWNER);
        assertEq(ETH.roles(ETH.getResource(rootToken), OWNER), ROOT_ROLES);
        assertEq(ETH.getExpiry(rootToken), block.timestamp + 365 days);
        assertEq(USDC.balanceOf(OWNER), 0);
    }

    function _newRegistry(uint256 salt) internal returns (IPermissionedRegistry registry) {
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(OWNER, GRANTS);
        address predicted = FACTORY.predictProxyAddress(OWNER, salt);
        assertEq(predicted.code.length, 0);
        vm.prank(OWNER);
        registry = IPermissionedRegistry(
            FACTORY.deployProxy(IMPL, salt, abi.encodeWithSignature("initialize((address,uint256)[])", grants))
        );
        assertEq(address(registry), predicted);
        assertEq(FACTORY.verifyContract(address(registry)), IMPL);
        assertEq(registry.roles(registry.ROOT_RESOURCE(), OWNER), GRANTS);
        assertEq(registry.roleCount(registry.ROOT_RESOURCE()), GRANTS);
    }

    function _registries() internal {
        r1 = _newRegistry(R1_SALT);
        _step(5);
        vm.prank(OWNER);
        ETH.setSubregistry(rootToken, r1);
        _step(6);
        vm.prank(OWNER);
        r1.setParent(ETH, rootLabel);
        _step(7);
        lockExpiry = uint64(block.timestamp + 90 days);
        vm.prank(OWNER);
        lockToken = r1.register("lock", OWNER, IRegistry(address(0)), address(0), LOCK_ROLES, lockExpiry);
        _step(8);
        assertEq(r1.roles(r1.getResource(lockToken), OWNER), LOCK_ROLES);
        r2 = _newRegistry(R2_SALT);
        _step(9);
        vm.prank(OWNER);
        r1.setSubregistry(lockToken, r2);
        _step(10);
        vm.prank(OWNER);
        r2.setParent(r1, "lock");
        _step(11);
    }

    function _products() internal {
        vm.prank(OWNER);
        registrar = new CredentialRegistrar(OWNER, rootLabel, r1, r2);
        _step(12);
        vm.prank(OWNER);
        r2.grantRootRoles(4097, address(registrar));
        _step(13);
        assertEq(r2.roles(r2.ROOT_RESOURCE(), address(registrar)), 4097);
        assertEq(r2.roleCount(r2.ROOT_RESOURCE()), GRANTS + 4097);
        vm.prank(OWNER);
        door = new DoorKeys(OWNER, rootLabel, r1, r2, 1);
        _step(14);
        guestExpiry = uint64(block.timestamp + 1 days);
        vm.prank(OWNER);
        guestToken = registrar.issue("mira", GUEST, guestExpiry);
        _step(15);
    }

    function _at(Vm.Log[] memory logs, uint256 index, address emitter, string memory signature) internal pure {
        assertEq(logs[index].emitter, emitter);
        assertEq(logs[index].topics[0], keccak256(bytes(signature)));
    }

    function _registered(Vm.Log[] memory logs, uint256 start, address registry, bool roles) internal pure {
        _at(logs, start, LABEL_STORE, "Label(bytes32,string)");
        _at(logs, start + 1, registry, "LabelRegistered(uint256,bytes32,string,address,uint64,address)");
        _at(logs, start + 2, registry, "TransferSingle(address,address,address,uint256,uint256)");
        _at(logs, start + 3, registry, "TokenResource(uint256,uint256)");
        if (roles) _at(logs, start + 4, registry, "EACRolesChanged(uint256,address,uint256,uint256)");
    }

    function _step(uint256 step) internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(step, ++completed);
        if (step == 1 || step == 2) {
            assertEq(logs.length, 1);
            _at(
                logs,
                0,
                address(USDC),
                step == 1 ? "Transfer(address,address,uint256)" : "Approval(address,address,uint256)"
            );
            assertEq(logs[0].topics[1], bytes32(uint256(uint160(step == 1 ? address(0) : OWNER))));
            assertEq(logs[0].topics[2], bytes32(uint256(uint160(step == 1 ? OWNER : address(REG)))));
            assertEq(abi.decode(logs[0].data, (uint256)), price);
        } else if (step == 3) {
            assertEq(logs.length, 1);
            _at(logs, 0, address(REG), "CommitmentMade(bytes32)");
            assertEq(abi.decode(logs[0].data, (bytes32)), commitment);
        } else if (step == 4) {
            assertEq(logs.length, 7);
            _at(logs, 0, address(USDC), "Transfer(address,address,uint256)");
            _registered(logs, 1, address(ETH), true);
            _at(
                logs,
                6,
                address(REG),
                "NameRegistered(uint256,string,address,address,address,uint64,address,bytes32,uint256,uint256)"
            );
            assertEq(uint256(logs[6].topics[1]), rootToken);
            assertEq(logs[6].topics[2], bytes32(0));
        } else if (step == 5 || step == 9) {
            address registry = step == 5 ? address(r1) : address(r2);
            assertEq(logs.length, 6);
            _at(logs, 0, registry, "Upgraded(address)");
            _at(logs, 1, registry, "RegistryCreated()");
            _at(logs, 2, registry, "EACRolesChanged(uint256,address,uint256,uint256)");
            _at(logs, 3, registry, "URIUpdated(string,address,address)");
            _at(logs, 4, registry, "Initialized(uint64)");
            _at(logs, 5, address(FACTORY), "ProxyDeployed(address,address,uint256,address)");
            assertEq(abi.decode(logs[4].data, (uint64)), 1);
            assertEq(uint256(logs[0].topics[1]), uint256(uint160(IMPL)));
            assertEq(uint256(logs[5].topics[1]), uint256(uint160(OWNER)));
            assertEq(uint256(logs[5].topics[2]), uint256(uint160(registry)));
            (uint256 salt, address impl) = abi.decode(logs[5].data, (uint256, address));
            assertEq(salt, step == 5 ? R1_SALT : R2_SALT);
            assertEq(impl, IMPL);
        } else if (step == 6 || step == 10) {
            assertEq(logs.length, 1);
            _at(logs, 0, step == 6 ? address(ETH) : address(r1), "SubregistryUpdated(uint256,address,address)");
            assertEq(uint256(logs[0].topics[1]), step == 6 ? rootToken : lockToken);
            assertEq(uint256(logs[0].topics[2]), uint256(uint160(step == 6 ? address(r1) : address(r2))));
        } else if (step == 7 || step == 11) {
            assertEq(logs.length, 1);
            _at(logs, 0, step == 7 ? address(r1) : address(r2), "ParentUpdated(address,string,address)");
            assertEq(uint256(logs[0].topics[1]), uint256(uint160(step == 7 ? address(ETH) : address(r1))));
        } else if (step == 8) {
            assertEq(logs.length, 5);
            _registered(logs, 0, address(r1), true);
        } else if (step == 12 || step == 14) {
            assertEq(logs.length, 0);
        } else if (step == 13) {
            assertEq(logs.length, 1);
            _at(logs, 0, address(r2), "EACRolesChanged(uint256,address,uint256,uint256)");
            (uint256 oldRoles, uint256 newRoles) = abi.decode(logs[0].data, (uint256, uint256));
            assertEq(oldRoles, 0);
            assertEq(newRoles, 4097);
        } else {
            assertEq(step, 15);
            assertEq(logs.length, 5);
            _registered(logs, 0, address(r2), false);
            _at(logs, 4, address(registrar), "CredentialIssued(bytes32,uint256,address,uint64)");
            assertEq(logs[4].topics[1], bytes32(LibLabel.id("mira")));
            assertEq(uint256(logs[4].topics[2]), guestToken);
            assertEq(uint256(logs[4].topics[3]), uint256(uint160(GUEST)));
            assertEq(abi.decode(logs[4].data, (uint64)), guestExpiry);
        }
        console2.log("TEST_ONLY ordered action", step);
    }
}
