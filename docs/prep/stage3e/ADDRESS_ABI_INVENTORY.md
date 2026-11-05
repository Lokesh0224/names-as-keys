# Verified Sepolia address and ABI inventory

Observation: chain 11155111, block 12071722 (`0xc04ccaa3bca48c67ad47a72f7d94b3c44202413f5d548f44cb0cf1a1a139011d`). All 16 addresses agree with the [official ENS Sepolia table](https://docs.ens.domains/learn/deployments/#sepolia-ensv2). VERIFIED means address agreement/code presence at this block; it does not mean project ownership or complete source equivalence.

| Contract | Address | Runtime bytes | Classification |
|---|---|---:|---|
| ETHRegistry | `0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4` | 16000 | VERIFIED |
| ETHRegistrar | `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3` | 8037 | VERIFIED |
| RootRegistry | `0xb458d6a3a77919449d03e7a6903c26827c1ec43f` | 16000 | VERIFIED |
| UpgradableUniversalResolverProxy | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` | 2491 | VERIFIED |
| ManagedUniversalResolverProxy | `0x6d80F2172CFdEc5730fE683860C33d26fC42e6F1` | 2612 | VERIFIED |
| UniversalResolverV2 | `0x24e1d8e068620b647ca097f961a61055f4f42d72` | 18792 | VERIFIED |
| VerifiableFactory | `0xda70306c98e97ece36f997a21368e53298572991` | 1524 | VERIFIED |
| UserRegistryImpl | `0x9bd8a88719068d09ecee662f36c0e3856708366a` | 18982 | VERIFIED |
| PermissionedResolverImpl | `0x115eb53f0c60696633855f90b138178fb40b2b2c` | 15608 | VERIFIED |
| PublicResolverV2 | `0xdc4a563d00f5c3012b699794eb9e13a561be386f` | 14327 | VERIFIED |
| StandardRentPriceOracle | `0x8196665d4ca7488b6474a9ec8e7d2719fb42263a` | 8355 | VERIFIED |
| MockUSDC | `0x240b0316df57887dbbe58b586508b19e633a14aa` | 4309 | VERIFIED |
| MockDAI | `0xf6fac8a58a0be13b9197f27c41b73162fe32572b` | 4309 | VERIFIED |
| LabelStore | `0xed8246ff02203a4d4cb262bd78beaa7408a57cae` | 1930 | VERIFIED |
| WrapperRegistryImpl | `0xbe768b63e5fbbfbb0ae97e9064e0002df8001880` | 24118 | VERIFIED |
| BatchRegistrar | `0x4a4c8b7cdab6b19dc2cdb417cdb53a2ccbaf5322` | 2196 | VERIFIED |

`address-abi-inventory.json` contains runtime Keccak hashes, ABI paths/hashes and provenance. `abis/` exports eight complete official deployment ABIs (ETHRegistrar, ETHRegistry, RootRegistry, UserRegistryImpl, VerifiableFactory, MockUSDC, MockDAI, StandardRentPriceOracle) and the two complete locally compiled production ABIs. Other listed resolution/migration helper addresses are not used for deployment and no ABI equivalence claim is made for them. Every proposed transaction and nested initializer signature is checked against exported ABIs. Consumed vendored functions' input/output types and mutability are checked against those complete deployment ABIs.

**UNVERIFIED future addresses:** R1, R2, CredentialRegistrar, DoorKeys. They are JSON null, not zero-address substitutions. Owner and guest public accounts are also null. Zero addresses in register arguments intentionally mean no child registry or resolver; they never stand for an unknown future contract.

Project constructor signatures:

- CredentialRegistrar: `constructor(address,string,address,address)`.
- DoorKeys: `constructor(address,string,address,address,uint256)`.

Exported production ABIs are byte-for-byte JSON-data-equal to current Foundry ABI output. Their source files are unchanged. Compiler-produced creation-bytecode hashes are recorded but no instance has been created. The ABI snapshot does not expose or require a private key.
