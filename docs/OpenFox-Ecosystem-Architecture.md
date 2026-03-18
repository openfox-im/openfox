# OpenFox Ecosystem Architecture

This document defines the official relationship between:

- `gtos`
- `tolang`
- `tosdk`
- `OpenSkills`
- `OpenFox`

The goal is to keep the stack secure, extensible, and operationally clean as
proof-heavy and cryptography-heavy capabilities continue to grow.

## 1. Design Principle

The stack is intentionally split into five layers:

- `gtos`
  - the base settlement, execution, and discovery network
- `tolang`
  - the agent-native contract language and artifact layer
- `tosdk`
  - the native TOS network SDK
- `OpenSkills`
  - reusable skill packages and cryptographic backends
- `OpenFox`
  - the long-running agent runtime and protocol shell

These layers should evolve independently and should not collapse back into one
large repository.

## 2. GTOS

`gtos` is the base network and protocol implementation.

`gtos` owns:

- native transaction rules
- signer and paymaster semantics
- discovery and gateway protocol hooks
- system actions and protocol-native modules
- settlement and coordination primitives
- storage, proof, and artifact anchoring substrates
- validator, consensus, and RPC behavior

`gtos` should remain the place where base-layer guarantees live:

- network security
- execution semantics
- canonical state transitions
- native RPC surfaces
- machine-verifiable coordination rules

`gtos` should not absorb product runtime logic that belongs in `OpenFox`.

## 3. TOLANG

`tolang` is the contract language and ABI/artifact layer for agent-native
programs.

`tolang` owns:

- agent-native contract semantics
- verifiable ABI and effect annotations
- metered contract compilation
- composability contracts for external calls and capabilities
- task, oracle, agent, manifest, and payment language primitives

`tolang` should remain focused on:

- language design
- compiler outputs
- artifact and ABI integrity
- machine-readable contract behavior for agents

`tolang` should not become the runtime agent shell or the general-purpose SDK.

## 4. TOSDK

`tosdk` is the native network SDK.

`tosdk` owns:

- TOS-native wallets and account types
- 32-byte address handling
- signing and serialization
- public and wallet clients
- settlement and market binding helpers
- requester-side provider clients
- reusable network-facing examples

`tosdk` should remain focused on:

- protocol encoding
- client transport
- signing
- hashing
- request/response helpers

It should not grow a long-running runtime or operator shell.

## 5. OpenSkills

`OpenSkills` is the reusable skill and cryptographic backend layer.

`OpenSkills` owns:

- standards-oriented `SKILL.md` packages
- reusable cryptographic skill definitions
- backend contracts for proof-heavy capabilities
- native cryptographic implementations shared across products

Current and expected examples include:

- `zktls`
- `proofverify`
- `crypto-secp256k1`
- `crypto-secp256r1`
- `crypto-ed25519`
- `crypto-bls12-381`
- `crypto-rangeproofs`
- `crypto-uno-proofs`

`OpenSkills` is where the underlying algorithmic and backend substrate should
live, whether the implementation is exposed through:

- a Rust CLI worker
- a native binding
- a deterministic helper process

For `OpenFox`, the preferred server-side direction for proof-heavy backends
remains:

- Rust-first worker implementations
- bounded invocation by `OpenFox`
- structured `stdin/stdout` or equivalent deterministic worker contracts

This means `OpenSkills` may contain reusable native code, but `OpenFox` still
treats those backends as bounded workers behind stable provider shells.

## 6. OpenFox

`OpenFox` is the runtime, operator surface, and service shell.

`OpenFox` owns:

- the local-first runtime
- discovery and gateway participation
- payment and `x402` flows
- anti-replay, idempotency, bounded request policy, and persistence
- task marketplace, provider services, settlement, and storage orchestration
- operator UX:
  - `status`
  - `doctor`
  - `health`
  - `dashboard`
  - `service`
  - `fleet`
- owner-facing reports and control-plane surfaces

`OpenFox` should continue to implement:

- protocol shells
- backend selection and orchestration
- queueing and retries
- durable records
- operator-visible summaries

`OpenFox` should not become the place where heavy cryptographic algorithms are
implemented directly in TypeScript.

## 7. Integration Model

The intended integration model is:

1. `tolang` defines machine-readable contract and artifact behavior on top of
   `gtos`.
2. `tosdk` provides the native client, wallet, signing, and transport surface
   for that network.
3. `OpenFox` uses `tosdk` to speak to `gtos` and consume `tolang`-oriented
   contract surfaces.
4. `OpenFox` exposes provider shells such as `news.fetch` or `proof.verify`.
5. `OpenFox` enforces request bounds, payment, replay protection, persistence,
   and operator visibility.
6. `OpenFox` selects a backend stage or worker contract.
7. The actual cryptographic or proof-heavy implementation comes from
   `OpenSkills`.

In short:

- `gtos` settles and coordinates
- `tolang` defines agent-native contract behavior
- `tosdk` signs and talks to the network
- `OpenSkills` proves and verifies
- `OpenFox` orchestrates and operates

## 8. Concrete Examples

### 6.1 `news.fetch`

`OpenFox` should provide:

- the HTTP/provider shell
- source policy enforcement
- payment handling
- persistence
- operator summaries

`OpenSkills` should provide:

- `newsfetch.capture`
- `zktls.bundle`

`tosdk` should provide:

- hashing helpers
- storage and settlement helpers
- network transport for any on-chain or provider-facing publication

`gtos` should provide:

- canonical settlement and proof publication substrates
- discovery and retrieval surfaces used by providers and subscribers

`tolang` should provide:

- contract-level bindings when verified news or evidence markets are expressed
  as agent-native contracts

### 6.2 `proof.verify`

`OpenFox` should provide:

- the provider shell
- verifier class routing
- request bounding
- durable verification records
- operator-visible summaries

`OpenSkills` should provide:

- `proofverify.verify`
- any native verifier implementation

`tosdk` should provide:

- canonical hashing helpers
- proof/result publication helpers when network interaction is needed

`gtos` should provide:

- canonical verifier publication and retrieval surfaces
- proof and receipt anchoring where applicable

`tolang` should provide:

- contract-safe proof/result interfaces when verifier outputs are consumed by
  on-chain agent-native programs

### 6.3 Signer and Paymaster Providers

`OpenFox` should provide:

- provider services
- discovery publication
- queueing and retries
- payment policies

`OpenSkills` may provide:

- future cryptographic or proof-heavy delegated execution helpers

`tosdk` should provide:

- native transaction construction
- signer and paymaster request helpers
- RPC and receipt handling

`gtos` should provide:

- native signer and paymaster semantics
- sponsor nonce, signer metadata, and settlement rules

`tolang` should provide:

- higher-level contract surfaces that can consume delegated execution safely

## 9. What Must Not Happen

The following are explicitly discouraged:

- moving base-layer protocol semantics out of `gtos`
- moving agent-native contract semantics out of `tolang`
- implementing heavy zkTLS or proof verifier logic directly in `OpenFox`
  TypeScript
- moving runtime/operator responsibilities into `OpenSkills`
- turning `tosdk` into a runtime or service framework
- turning `tolang` into a runtime shell
- duplicating the same cryptographic logic in both `OpenFox` and `OpenSkills`

## 10. Decision Rule

When adding a new capability, use this rule:

### Put it in `gtos` when it is about:

- base-layer execution semantics
- native transaction validation
- consensus and settlement rules
- discovery/gateway protocol primitives
- canonical state transitions and RPC exposure

### Put it in `tolang` when it is about:

- contract-language semantics
- ABI and artifact guarantees
- effect and meter annotations
- machine-readable contract behavior for agents

### Put it in `OpenFox` when it is about:

- protocol shells
- routing
- bounded policies
- persistence
- retries
- settlement
- operator and owner visibility

### Put it in `OpenSkills` when it is about:

- reusable skill contracts
- cryptographic algorithms
- proof generation
- proof verification
- native performance-sensitive backend logic

### Put it in `tosdk` when it is about:

- signing
- serialization
- RPC transport
- canonical network/client helpers

## 11. Target Outcome

This split gives the stack five clean properties:

- `gtos` stays authoritative at the base protocol layer
- `tolang` stays focused on agent-native contract meaning
- `tosdk` stays small, native, and embeddable
- `OpenSkills` stays reusable and security-focused
- `OpenFox` stays operational and product-oriented

That separation is the intended long-term architecture.
