# Phase 2a vendor drift audit

**Verdict: not determinable (BLOCKED: upstream source comparison and on-chain selector checks could not be completed; Sepolia RPC DNS resolution failed).**

Compared vendored tag `sepolia-deployment-2026-09-15`, commit `f2f0a05e6c1711134b73204a1e37f8e6c1aea6ab`, with requested target `07e55a056f5b6a9c90119f501bdd05714e67dddd`. The public ENS deployments page is reachable: https://docs.ens.domains/learn/deployments/. All deployments JSON entries listed on its Sepolia ENSv2 table match case-insensitively, including BatchRegistrar, ETHRegistrar, ETHRegistry, RootRegistry, UpgradableUniversalResolverProxy, ManagedUniversalResolverProxy, UniversalResolverV2, VerifiableFactory, UserRegistryImpl, PermissionedResolverImpl, PublicResolverV2, StandardRentPriceOracle, LabelStore, WrapperRegistryImpl. MockUSDC and MockDAI are absent from the table and are not compared. Address matching is not an on-chain code check.

The commit page was reachable, but both source trees could not be fetched for the required file-specific diff. No behavior conclusion follows from differing commit labels. Not compared: IStandardRegistry, IPermissionedRegistry, ITokenizedRegistry/ITemporalRegistry, IEnhancedAccessControl, RegistryRolesLib, IVerifiableFactory, UserRegistry initialize/Grant, ETHRegistrar interfaces, resolver setter interfaces, IUniversalResolver, IRegistryEvents, and all error definitions.

`cast chain-id` and `cast block-number` failed with DNS resolution errors. Thus all on-chain selector presence and implementation-slot checks are BLOCKED; no bytecode or storage was observed. Selector presence, if later observed, is necessary but not sufficient evidence of compatible behavior (INFERENCE). This does not establish live deployment safety.

Human follow-up, from a networked machine and outside this repository:

```sh
git clone https://github.com/ensdomains/contracts-v2.git /tmp/contracts-v2-phase2a
git -C /tmp/contracts-v2-phase2a fetch origin f2f0a05e6c1711134b73204a1e37f8e6c1aea6ab 07e55a056f5b6a9c90119f501bdd05714e67dddd
# Diff only the required files listed above at both commits.
# Restore Sepolia RPC connectivity, then perform the prescribed read-only cast code/storage selector checks.
```
