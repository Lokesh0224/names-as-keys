import { Interface, ZeroAddress, ZeroHash } from 'ethers';
export const CHAIN_ID = 11155111n;
export const ROOT = 'nak-lokesh-20261105';
export const LOCK = 'lock';
export const GUEST = 'mira';
export const ZERO = ZeroAddress, ZERO32 = ZeroHash;
export const ROOT_DURATION = 31536000n, LOCK_DURATION = 7776000n, GUEST_DURATION = 86400n;
export const OWNER_ROLES = 380593917518227438537563280301172632627253505n;
export const LOCK_ROLES = 91700664256357922357994873537130062512592519168n;
export const ROOT_ROLES = 97409655027181761882228017414928043058140282880n;
export const ISSUER_ROLES = 4097n;
export const SALTS = { R1: 31001n, R2: 31002n }; // Public salts from ordered fork fixture; caller-bound.
export const MAX_RENT = 8100000n;
export const INFRA = Object.freeze({
  ETHRegistry: '0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4',
  ETHRegistrar: '0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3',
  RootRegistry: '0xb458d6a3a77919449d03e7a6903c26827c1ec43f',
  UpgradableUniversalResolverProxy: '0xeeeeeeee14d718c2b47d9923deab1335e144eeee',
  ManagedUniversalResolverProxy: '0x6d80f2172cfdec5730fe683860c33d26fc42e6f1',
  UniversalResolverV2: '0x24e1d8e068620b647ca097f961a61055f4f42d72',
  VerifiableFactory: '0xda70306c98e97ece36f997a21368e53298572991',
  UserRegistryImpl: '0x9bd8a88719068d09ecee662f36c0e3856708366a',
  PermissionedResolverImpl: '0x115eb53f0c60696633855f90b138178fb40b2b2c',
  PublicResolverV2: '0xdc4a563d00f5c3012b699794eb9e13a561be386f',
  StandardRentPriceOracle: '0x8196665d4ca7488b6474a9ec8e7d2719fb42263a',
  MockUSDC: '0x240b0316df57887dbbe58b586508b19e633a14aa',
  MockDAI: '0xf6fac8a58a0be13b9197f27c41b73162fe32572b',
  LabelStore: '0xed8246ff02203a4d4cb262bd78beaa7408a57cae',
  WrapperRegistryImpl: '0xbe768b63e5fbbfbb0ae97e9064e0002df8001880',
  BatchRegistrar: '0x4a4c8b7cdab6b19dc2cdb417cdb53a2ccbaf5322',
  FactoryLogic: '0xc41576b4b809b99cf0ff2e5b41b4f147cd9b6bdd',
});
export const REGISTRY_ABI = [
  'function getState(uint256) view returns ((uint8 status,uint64 expiry,address latestOwner,uint256 tokenId,uint256 resource))',
  'function getOwner(uint256) view returns(address)', 'function getExpiry(uint256) view returns(uint64)',
  'function getSubregistry(string) view returns(address)', 'function getResolver(string) view returns(address)',
  'function getParent() view returns(address,string)', 'function roles(uint256,address) view returns(uint256)',
  'function roleCount(uint256) view returns(uint256)', 'function ROOT_RESOURCE() view returns(uint256)',
  'function isEmancipated() view returns(bool)', 'function hasRootRoles(uint256,address) view returns(bool)',
  'function initialize((address account,uint256 roleBitmap)[])',
  'function register(string,address,address,address,uint256,uint64) returns(uint256)',
  'function setSubregistry(uint256,address)', 'function setParent(address,string)', 'function grantRootRoles(uint256,address)',
  'event LabelRegistered(uint256 indexed tokenId,bytes32 indexed labelHash,string label,address owner,uint64 expiry,address indexed sender)',
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
  'event TokenResource(uint256 indexed tokenId,uint256 indexed resource)',
  'event EACRolesChanged(uint256 indexed resource,address indexed account,uint256 oldRoles,uint256 newRoles)',
  'event SubregistryUpdated(uint256 indexed tokenId,address indexed subregistry,address indexed sender)',
  'event ParentUpdated(address indexed parent,string label,address indexed sender)',
];
export const ABIS = {
  RootRegistry: ['function getSubregistry(string) view returns(address)'],
  ETHRegistry: REGISTRY_ABI, R1: REGISTRY_ABI, R2: REGISTRY_ABI,
  UserRegistryImpl: ['function LABEL_STORE() view returns(address)', 'function URI_RENDERER() view returns(address)'],
  ETHRegistrar: [
    'function ETH_REGISTRY() view returns(address)', 'function rentPriceOracle() view returns(address)',
    'function BENEFICIARY() view returns(address)', 'function isAvailable(string) view returns(bool)',
    'function getRegisterPrice(string,uint64,address) view returns(uint256,uint256)',
    'function MIN_COMMITMENT_AGE() view returns(uint64)', 'function MAX_COMMITMENT_AGE() view returns(uint64)',
    'function commitmentAt(bytes32) view returns(uint64)',
    'function makeCommitment(string,address,bytes32,address,address,uint64,bytes32) pure returns(bytes32)',
    'function commit(bytes32)', 'function register(string,address,bytes32,address,address,uint64,address,bytes32) returns(uint256)',
    'event CommitmentMade(bytes32 commitment)',
    'event NameRegistered(uint256 indexed tokenId,string label,address owner,address subregistry,address resolver,uint64 duration,address paymentToken,bytes32 indexed referrer,uint256 base,uint256 premium)',
  ],
  MockUSDC: ['function mint(address,uint256)', 'function approve(address,uint256) returns(bool)',
    'function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)',
    'event Transfer(address indexed from,address indexed to,uint256 value)', 'event Approval(address indexed owner,address indexed spender,uint256 value)'],
  VerifiableFactory: ['function deployProxy(address,uint256,bytes) returns(address)',
    'function verifyContract(address) view returns(address)', 'function proxyLogic() view returns(address)',
    'event ProxyDeployed(address indexed sender,address indexed proxyAddress,uint256 salt,address implementation)'],
  LabelStore: ['function getLabel(uint256) view returns(string)', 'event Label(bytes32 indexed labelHash,string label)'],
};
export const INTERFACES = Object.fromEntries(Object.entries(ABIS).map(([n,a]) => [n,new Interface(a)]));
export const STEP_IDS = Array.from({length:15}, (_,i) => 'T'+String(i+1).padStart(2,'0'));

// The CREATE steps need more headroom than registry/token calls; never exceed the transaction cap.
export const MAX_TRANSACTION_GAS = 16777216n;
export const GAS_CEILINGS = Object.freeze(Object.fromEntries(
  STEP_IDS.map(step => [step, ['T12','T14'].includes(step) ? MAX_TRANSACTION_GAS : 3000000n]),
));
