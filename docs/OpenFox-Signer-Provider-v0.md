# OpenFox Signer-Provider v0

## 1. Goal

The goal is to let an OpenFox operator use a programmable wallet on `TOS` without handing over the wallet's primary secret to a remote service.

In one sentence:

`OpenFox Signer-Provider v0` turns a programmable `TOS` wallet into a network service that can authorize bounded delegated execution by other agents.

This is not a custodial hosted wallet product.
It is a policy-constrained delegated execution service for agent operators.

## 2. Why This Belongs in the Mainline

This capability is not an isolated feature.
It is the execution-control layer that sits on top of the wallet, payment, storage, artifact, and settlement layers already added to OpenFox.

It directly strengthens the existing product loops:

- bounty hosts can delegate payout and result-publication execution
- oracle and observation providers can delegate settlement and callback submission
- storage providers can delegate renewal, audit, and anchor maintenance
- long-running operators can use hot keys or sub-agents without exposing the treasury root key

The mainline becomes:

`wallet -> payable services -> settlement -> storage/artifacts -> programmable delegated execution`

## 3. Existing Ground Truth

This design assumes the lower-level primitives already exist in `tolang` and `gtos`:

- `account contract` wallets with protocol-called `validate(tx_hash, sig)`
- `delegation.verify(...)` with nonce, scope, expiry, and replay protection
- `@delegated` and account-abstraction markers in the language/compiler path

This means OpenFox does not need to invent a new custody model.
It needs to package these primitives into a discoverable, paid, operator-facing network service.

## 4. Product Definition

An OpenFox signer-provider is an agent that:

- publishes a `signer-provider` capability through Agent Discovery
- accepts bounded execution requests from another agent
- submits transactions to `TOS` using a delegated key or session key already authorized by the programmable wallet
- returns an auditable execution receipt
- charges per call or via a renewable service plan

The important boundary is:

- the provider does **not** need the principal wallet's primary private key
- the provider only acts inside the wallet contract's on-chain policy

## 5. Roles

### 5.1 Principal Operator

The human or agent that owns the programmable wallet.
The principal defines the policy boundary:

- allowed targets
- allowed function selectors
- amount/value caps
- expiry
- daily or per-call limits

### 5.2 Programmable Wallet

An `account contract` on `TOS`.
This is the real trust anchor.
It decides whether a delegated execution request is valid.

### 5.3 Signer-Provider Agent

A network-visible OpenFox service that:

- receives execution requests
- checks local provider policy
- submits the transaction
- tracks status and receipts

### 5.4 Requester Agent

The agent asking the signer-provider to execute on behalf of the programmable wallet.
In many cases the requester and the principal are the same operator, but they do not need to be.

### 5.5 Sponsor / Funding Service

Optional in later phases.
Not required for `v0`.

`v0` assumes the programmable wallet already has enough `TOS` to pass validation and execution gas checks, or uses an existing separate funding path such as local funding or `sponsor.topup.testnet`.

## 6. Trust and Security Model

The design must preserve one principle:

**do not outsource the root wallet secret when a delegated policy can express the same thing.**

So the intended model is:

- root owner key remains with the principal
- provider uses a delegated key, session key, or narrowly authorized signing identity
- wallet policy enforces what the provider may do
- every delegated request is replay-protected
- every execution returns a durable receipt

This is closer to a secretary with a limited mandate than to a custodian with full control.

### 6.1 Trust Tiers for Provider Selection

OpenFox should treat signer-provider selection as a policy choice, not as an all-or-nothing trust decision.

`v0` defines three trust tiers:

- `self_hosted`
- `org_trusted`
- `public_low_trust`

These tiers describe how much operational trust the principal places in the provider and how strict the delegated wallet policy must be.

### 6.2 `self_hosted`

Use when:

- the operator runs the signer-provider personally
- the wallet controls high-value funds
- the delegated execution path is long-lived or operationally critical

Expected policy posture:

- broadest allowed scope among the three tiers
- still policy-bounded and revocable
- suitable for treasury maintenance, recurring settlement, and long-running automation

### 6.3 `org_trusted`

Use when:

- the provider is operated by the same team, project, or formally trusted partner
- the operator wants managed execution without exposing the root wallet key broadly

Expected policy posture:

- narrower than `self_hosted`
- explicit target, selector, value, and expiry limits
- suitable for internal operations such as callbacks, anchor submission, and moderate-value payouts

### 6.4 `public_low_trust`

Use when:

- the provider is a third-party public network service
- the principal wants convenience but does not want to rely on provider goodwill

Expected policy posture:

- smallest value caps
- shortest expiry
- narrowest target/function allowlist
- strongest receipt and confirmation requirements

This tier should only be used for low-risk bounded tasks such as:

- storage renewals
- artifact anchors
- settlement callbacks
- small-value payouts

### 6.5 Selection Rule

The selection rule should be:

- never choose a lower-control tier than the wallet policy can safely tolerate
- never use `public_low_trust` for treasury-like authority
- prefer `self_hosted` by default for high-value or long-lived execution authority

In other words:

**do not ask "do I trust this provider?"**
Ask:

**"what is the highest-risk action this provider is allowed to perform under this tier?"**

### 6.6 Default Policy Matrix

`trust_tier` should map to a default policy profile.
These defaults are not the only possible configuration, but they define the safe baseline for `v0`.

| trust_tier | Intended operator trust | Allowed targets | Allowed selectors | Value cap | TTL | Daily limit | Receipt / confirmation posture | Recommended use |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `self_hosted` | operator controls the provider directly | broad allowlist chosen by operator | broad allowlist chosen by operator | high, but still explicit | long-lived | high, but still explicit | standard receipt persistence | treasury maintenance, recurring settlement, long-running automation |
| `org_trusted` | same team, project, or formally trusted partner | explicit allowlist only | explicit allowlist only | moderate | medium | moderate | durable receipts plus stronger operator review | callbacks, anchors, moderate-value payouts, shared operational automation |
| `public_low_trust` | public third-party provider | minimal allowlist only | minimal allowlist only | low | short-lived | low | durable receipts plus confirmation-first handling | storage renewals, artifact anchors, settlement callbacks, small-value payouts |

Interpretation rules:

- `self_hosted` is still policy-constrained; it is not unlimited custody.
- `org_trusted` should be treated as operationally trusted, not economically unlimited.
- `public_low_trust` should default to the narrowest target/function/value envelope available.
- any request outside the default tier policy should require an explicit operator override.

## 7. Capability Surface

Suggested `v0` capability surface:

- `signer.quote`
- `signer.submit`
- `signer.status`
- `signer.receipt`

Optional later:

- `signer.plan.subscribe`
- `signer.plan.renew`
- `signer.revoke`

The public API should be execution-centric, not raw-signature-centric.
The provider should not become a generic "sign arbitrary bytes" endpoint.

## 8. Naming Rules

The naming rule for `v0` should be:

**keep protocol objects chain-neutral; keep chain adapters chain-specific.**

This means:

- protocol-level object names should not bake `TOS` into every type or field
- runtime/service APIs should describe the execution role first
- chain-specific naming is appropriate inside the adapter layer that actually talks to `TOS`

Recommended pattern:

- protocol object names:
  - `SignerPolicyRef`
  - `SignerQuote`
  - `SignerExecutionRequest`
  - `SignerExecutionReceipt`
- protocol field names:
  - `wallet_address`
  - `provider_address`
  - `policy_hash`
  - `delegate_identity`
  - `trust_tier`
- chain-adapter names:
  - `tosClient`
  - `tosSubmitTransaction`
  - `TosAccountIdentity`

Avoid names like:

- `TosSignerQuote`
- `tos_wallet_address`
- `TosSignerExecutionReceipt`

Reason:

- OpenFox is building a runtime capability, not hard-coding the chain name into every protocol object
- the signer-provider market should remain legible as a reusable OpenFox subsystem
- chain binding should stay explicit in the adapter/integration layer, where it belongs

## 9. Canonical Objects

### 9.1 SignerPolicyRef

Describes the on-chain or locally cached policy the provider believes it is operating under.

Suggested fields:

- `wallet_address`
- `policy_id`
- `policy_hash`
- `delegate_identity`
- `scope_hash`
- `expires_at`
- `trust_tier`

### 9.2 SignerQuote

The commercial quote for delegated execution.

Suggested fields:

- `quote_id`
- `provider_address`
- `wallet_address`
- `pricing_model`
- `amount_wei`
- `expires_at`

### 9.3 SignerExecutionRequest

The actual request sent to the provider.

Suggested fields:

- `wallet_address`
- `target`
- `value`
- `data`
- `request_nonce`
- `request_expires_at`
- `quote_id`
- `policy_hash`
- `reason`

### 9.4 SignerExecutionReceipt

The durable result of provider submission.

Suggested fields:

- `execution_id`
- `wallet_address`
- `provider_address`
- `request_hash`
- `policy_hash`
- `submitted_tx_hash`
- `status`
- `submitted_at`
- `confirmed_at`
- `error`

## 10. Execution Flow

### Flow A: Per-Call Delegated Execution

1. Principal deploys or already controls an `account contract` wallet.
2. Principal authorizes a provider key, session key, or delegated identity under bounded policy.
3. Provider publishes `signer.quote` and `signer.submit` through Agent Discovery and optional Agent Gateway.
4. Requester obtains a quote and pays via `x402`.
5. Requester sends a `signer.submit` request with the intended wallet call.
6. Provider submits the transaction to `TOS`.
7. The wallet contract's `validate()` and delegation logic decide whether the call is allowed.
8. Provider persists and returns a `SignerExecutionReceipt`.

### Flow B: Subscription or Retainer Model

1. Principal pre-authorizes the provider for a longer validity window.
2. Requester pays a recurring plan.
3. Provider executes bounded operational tasks over time:
   - storage renewals
   - artifact anchors
   - oracle callbacks
   - bounty payouts
4. Every action still produces a per-execution receipt.

## 11. OpenFox Integration

`v0` should integrate with existing OpenFox subsystems instead of inventing a new island:

### 11.1 Agent Discovery and Gateway

- publish signer-provider capabilities through existing card/gateway surfaces
- allow signer-provider nodes to be reachable behind the gateway

### 11.2 x402 Payments

- quote and submit paths should use the existing paid-provider model
- payment must bind to an execution request and resulting receipt

### 11.3 Wallet and TOS Client

- add a remote execution path beside the current local wallet path
- keep local wallet support as the default baseline

### 11.4 Database and Operator UX

- persist quotes, execution requests, execution receipts, and provider status
- expose signer-provider visibility in `status`, `health`, and `doctor`
- persist the operator-selected `trust_tier` and surface it in diagnostics

### 11.5 Storage and Artifact Layers

- signer execution receipts may later be bundled into the storage/artifact pipeline
- this makes delegated execution auditable using the same immutable artifact patterns already adopted elsewhere in OpenFox

## 12. v0 Scope

`v0` should stay narrow.

Included:

- one provider mode inside OpenFox
- per-call pricing
- bounded delegated execution
- durable receipt persistence
- discovery and gateway publication
- trust-tier-based provider selection rules
- status / health / doctor visibility

Explicitly not included:

- generic arbitrary-byte signing service
- full custodial wallet hosting
- ERC-4337-style paymaster economics
- chain-native subscription contracts
- multi-provider consensus signing
- threshold custody or MPC

## 13. Important Constraint: Funding

`v0` must not pretend that delegated execution removes gas requirements.

Today the underlying `gtos` execution path still expects the submitting account or programmable wallet path to satisfy validation and execution gas requirements.

So `v0` should assume one of the following:

- the programmable wallet already holds enough `TOS`
- the operator uses a separate funding flow before delegated execution

A true sponsor/paymaster layer is future work.

## 14. Acceptance Criteria

`Signer-Provider v0` is successful when:

- one OpenFox node can publish signer-provider capability through Discovery
- another OpenFox node can request a quote and pay for delegated execution
- the provider can submit a bounded wallet call that passes wallet `validate()`
- the provider cannot exceed the delegated policy boundary
- the system persists an auditable execution receipt
- signer-provider activity is visible in `openfox status`, `openfox health`, and `openfox doctor`

## 15. Relationship to the Broader Roadmap

This phase should come after the storage and artifact foundations, not before them.

Reason:

- storage/artifacts solved how OpenFox stores and anchors large immutable outputs
- signer-provider solves how OpenFox safely operates programmable wallets over time
- together they form the next layer of agent infrastructure:
  - artifact persistence
  - settlement anchoring
  - delegated execution and lifecycle maintenance

That is why signer-provider should be treated as the next mainline control-plane phase for OpenFox, not as a side experiment.
