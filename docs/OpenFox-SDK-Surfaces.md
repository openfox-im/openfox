# OpenFox SDK and Runtime Surfaces

OpenFox now sits on top of five reusable surfaces:

## 1. `gtos`

Use `gtos` when you need:

- the authoritative base protocol
- native transaction and settlement rules
- discovery and gateway protocol primitives
- canonical state transitions and RPC behavior

## 2. `tolang`

Use `tolang` when you need:

- agent-native contract authoring
- machine-readable ABI and artifact semantics
- effect and gas annotations
- capability-aware contract surfaces for agents

## 3. `tosdk`

Use `tosdk` directly when you need:

- native account and address handling
- transaction signing
- native public and wallet clients
- settlement receipt helpers
- market binding helpers
- delegated execution requester clients
- typed provider request/response shapes for third-party integrations
- repository examples for native wallets and requester/provider integrations

## 4. `openskills`

Use `openskills` when you need:

- reusable `SKILL.md` packages
- cryptographic skill contracts
- proof-heavy backend substrates
- native algorithm implementations that should stay outside the OpenFox runtime
- `zktls` backends: MPC-TLS proving, attestation verification (native), evidence bundling
- `proofverify` backends: hash integrity, TLSNotary attestation validation (native dual-path), M-of-N consensus

Practical rule:

- choose `openskills` for reusable proof and crypto backends
- keep those backends behind bounded OpenFox provider shells

## 5. `openfox`

Use OpenFox when you need:

- a long-running runtime
- discovery and gateway participation
- paid provider surfaces
- task marketplace automation
- operator UX
- payment ledgering and retries

## Practical rule

- choose `gtos` for base protocol and network rules
- choose `tolang` for agent-native contract surfaces
- choose `tosdk` for low-level integration
- choose `openskills` for reusable proof/crypto skill backends
- choose OpenFox for agent runtime integration

That separation is the main productization boundary for the current stack.

See also:

- `../tosdk/examples/network-wallet.ts`
- `../tosdk/examples/provider-clients.ts`
- `../tosdk/examples/delegated-execution.ts`
- `../tosdk/examples/storage-and-artifacts.ts`
- `../tosdk/examples/marketplace-and-settlement.ts`
- `../tosdk/examples/provider-service-shapes.ts`
- `OpenFox-Ecosystem-Architecture.md`

Practical builder guidance:

- choose `gtos` when you are building:
  - protocol-native modules
  - RPC consumers that depend on canonical base-layer behavior
  - settlement or discovery features that must live in the network itself
- choose `tolang` when you are building:
  - agent-native contracts
  - effect-annotated marketplace or oracle contracts
  - contract artifacts that agents can verify before calling
- choose `tosdk` when you are building:
  - a wallet
  - a requester client
  - a provider client
  - a small third-party integration
  - receipt/hash/market-binding utilities
- choose `openskills` when you are building:
  - reusable `SKILL.md` packages
  - cryptographic backends
  - zkTLS and proof-verifier worker contracts
  - native proof or verification helpers shared across products
- choose `openfox` when you are building:
  - a long-running provider
  - a requester/solver/host runtime
  - a discovery/gateway participant
  - an operator-managed public service
  - a task marketplace or paid service surface
