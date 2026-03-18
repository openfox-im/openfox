# OpenFox Paymaster-Provider v0

## 1. Goal

The goal is to make sponsored execution a first-class native capability of `TOS`, then expose it through OpenFox as a discoverable network service.

In one sentence:

`OpenFox Paymaster-Provider v0` turns native `TOS` sponsorship into a paid or policy-bounded provider role that can cover validation and execution costs for another wallet's transaction.

This is the strong version of paymaster support.
It is not a faucet, not a top-up workaround, and not an off-chain glue layer around ordinary sender-pays transactions.

## 2. Why This Belongs in the Mainline

Signer-provider and paymaster-provider solve different problems:

- signer-provider answers: **who is allowed to execute?**
- paymaster-provider answers: **who is allowed to pay for execution?**

Without native paymaster support, OpenFox still depends on one of two weaker patterns:

- the wallet already holds enough `TOS`
- a sponsor sends funds first and execution happens later

That is operationally clumsy and breaks the agent-native story.

The real mainline is:

`wallet -> paid services -> settlement -> storage/artifacts -> signer-provider -> paymaster-provider`

## 3. Existing Ground Truth

The current `gtos` execution path is still sender-pays:

- the current transaction envelope has no `paymaster` or `fee_payer` field
- pre-check balance uses `msg.From()`
- validation gas is deducted from `msg.From()`
- execution gas is deducted from `msg.From()`

So a true paymaster-provider cannot be built cleanly in OpenFox alone.
The protocol has to change.

## 4. Decision: Change the Native Protocol Now

Because neither `~/gtos` nor `~/openfox` has launched, `v0` should not carry backward-compatibility baggage.

So the design choice is:

- do not fake paymaster support with top-up flows
- do not preserve the current sender-pays-only transaction semantics
- add native sponsor-aware transaction support directly in `TOS`

This means `v0` is allowed to:

- add a new sponsored transaction type
- change mempool and pre-flight balance rules
- add new protocol-level validation hooks
- avoid any migration or legacy-mode complexity

## 5. Product Definition

A paymaster-provider is an OpenFox agent/operator that:

- publishes sponsorship capability through Agent Discovery
- evaluates a request against sponsor policy
- authorizes or rejects sponsorship for a specific execution request
- causes validation and execution gas to be charged to the sponsor side instead of the requester side
- returns a durable sponsorship receipt

The paymaster-provider does not replace signer-provider.
It composes with it.

Supported compositions:

- local signer + paymaster-provider
- signer-provider + paymaster-provider
- combined signer-provider + paymaster-provider on one node

## 6. Roles

### 6.1 Principal / Requester

The wallet owner or requesting agent that wants a transaction executed.

### 6.2 Signer-Provider

Optional.
Provides bounded delegated execution authority.

### 6.3 Paymaster-Provider

Provides bounded sponsorship authority.
It covers gas and validation cost under explicit sponsor policy.

### 6.4 Programmable Wallet

Still responsible for authorizing the action itself.
Paymaster support does not replace wallet policy.

### 6.5 Sponsor Account or Sponsor Contract

The on-chain identity from which validation and execution charges are paid.

## 7. Native Protocol Shape

### 7.1 Unified Sponsor-Aware Native Transaction

`v0` should unify sponsored execution into the ordinary native transaction
envelope instead of introducing a second transaction family.

Suggested direction:

- keep ordinary sender-pays transactions for simple direct use
- add optional sponsor authorization fields to the native transaction
- keep sponsor-side authorization aligned with ordinary native execution on
  signer-type coverage instead of shrinking sponsorship to `secp256k1` only

Suggested fields:

- `chain_id`
- `nonce`
- `gas`
- `to`
- `value`
- `data`
- `access_list`
- `from`
- `signer_type`
- `sponsor`
- `sponsor_signer_type`
- `sponsor_nonce`
- `sponsor_expiry`
- `sponsor_policy_hash`
- `exec_sig`
- `sponsor_sig`

The transaction hash must cover both execution and sponsorship fields.
Neither the relay nor the counterparty should be able to swap sponsor details after authorization.

### 7.1.1 Signer-Type Compatibility

Unified sponsor-aware native transactions should support the same signer-type
matrix as ordinary native execution.

That requirement applies to both:

- the execution/requester signature
- the sponsor/paymaster signature

`v0` should target support for the current `SignerType` set already recognized by `gtos`:

- `secp256k1`
- `schnorr`
- `secp256r1`
- `ed25519`
- `bls12-381`
- `elgamal`

The design goal is:

- do not make sponsor-aware native execution a multi-signer-type wrapper on the requester side while leaving sponsor authorization as `secp256k1`-only
- do not force OpenFox paymaster-provider operators onto a narrower signer set than ordinary wallet operators

#### SignerType Compatibility Matrix

| SignerType | Requester / execution signature | Sponsor / paymaster signature | v0 expectation | Notes |
| --- | --- | --- | --- | --- |
| `secp256k1` | supported | supported | required | baseline compatibility path |
| `schnorr` | supported | supported | required | sponsor side should not be forced back to ECDSA |
| `secp256r1` | supported | supported | required | useful for hardware- and enterprise-style signer flows |
| `ed25519` | supported | supported | required | important for agent and session-key ergonomics |
| `bls12-381` | supported | supported | required | especially relevant for aggregate or committee-oriented sponsor operations |
| `elgamal` | supported | supported | required | keeps parity with the broader `SignerTx` matrix already recognized by `gtos` |

Interpretation rules:

- every signer type supported by ordinary native execution should also be accepted by sponsor-aware native execution on the requester side
- every signer type supported by ordinary native execution should also be accepted by sponsor-aware native execution on the sponsor side
- no signer type should be "requester-only" in the final `v0` design unless the ordinary `SignerTx` matrix itself is intentionally reduced
- if implementation staging temporarily lands with partial sponsor-side support, that should be treated as incomplete work, not as the target architecture

### 7.2 Dual Authorization

Sponsored execution requires two independent approvals:

- **execution authorization**
  - from the wallet / signer / signer-provider side
- **sponsorship authorization**
  - from the paymaster-provider / sponsor side

Both must be valid for the transaction to execute.

### 7.3 Native Charging Rule

For sponsored transactions:

- validation gas is charged to the sponsor side
- execution gas is charged to the sponsor side
- requester balance no longer gates inclusion for that transaction

This is the core protocol change.

## 8. Required GTOS Changes

### 8.1 Transaction Envelope

- add unified sponsor-aware fields to the native transaction envelope
- add sponsor identity and sponsor witness fields
- add `sponsor_signer_type` so sponsor-side verification is not implicitly hard-coded to one algorithm family
- update hashing, signing, and RPC encoding accordingly

### 8.2 Mempool and Pre-Flight Checks

- stop requiring `msg.From()` to hold the full validation and execution budget for sponsored transactions
- require the sponsor side to satisfy pre-flight balance and policy checks
- reserve gas risk against the sponsor side before inclusion

### 8.3 State Transition

- validate execution authorization
- validate sponsorship authorization
- charge actual validation and execution gas to the sponsor side
- emit a receipt that records both requester and sponsor identities

### 8.4 Sponsor Policy Hooks

`gtos` should support one of these cleanly:

- a native sponsor registry / sponsor policy object
- a dedicated `paymaster contract` / `sponsor contract` type in `tolang`

The exact mechanism can vary, but `v0` needs a first-class protocol hook for sponsor validation.

### 8.6 Signer-Type Parity

`gtos` should treat signer-type support for sponsored transactions as a parity requirement, not as an optional enhancement.

This means:

- ordinary native execution and sponsor-aware native execution should share the same supported `SignerType` matrix
- requester-side and sponsor-side verification should both flow through the same signer-type-aware verification framework
- sponsor-side signing helpers should not be hard-coded to `secp256k1`

### 8.5 Failure Semantics

The protocol must define:

- who pays if sponsor authorization is valid but wallet validation later fails
- who pays if execution reverts after passing both validations
- how sponsor nonce reuse and replay are rejected
- how sponsor expiry and policy-hash mismatches are handled

The cleanest rule for `v0` is:

- once a valid sponsor authorization reaches protocol validation, sponsor-side validation cost is sponsor responsibility
- once execution begins, sponsor-side execution cost is sponsor responsibility

## 9. Required TOLANG Changes

`tolang` should add a first-class sponsorship model, not just documentation around it.

Suggested direction:

- add a `paymaster contract` or `sponsor contract` marker
- require a standard validation entrypoint for sponsor approval
- keep sponsorship compatible with the same signer-type set supported by ordinary programmable wallets
- expose sponsor policy primitives such as:
  - allowed wallets
  - allowed targets
  - allowed selectors
  - max validation gas
  - max execution gas
  - max value
  - expiry
  - nonce / replay protection

This keeps sponsorship programmable and inspectable, just like wallet-side delegated execution.

## 10. OpenFox Capability Surface

Suggested paymaster-provider capability surface:

- `paymaster.quote`
- `paymaster.authorize`
- `paymaster.status`
- `paymaster.receipt`

Optional later:

- `paymaster.plan.subscribe`
- `paymaster.plan.renew`
- `paymaster.submit`

`paymaster.authorize` should return a sponsor witness or sponsorship approval object that can be bound into the sponsored transaction.

## 11. Canonical Objects

### 11.1 PaymasterPolicyRef

Suggested fields:

- `sponsor_address`
- `policy_id`
- `policy_hash`
- `allowed_wallets`
- `allowed_targets`
- `allowed_selectors`
- `max_value`
- `expires_at`

### 11.2 PaymasterQuote

Suggested fields:

- `quote_id`
- `provider_address`
- `sponsor_address`
- `pricing_model`
- `amount_wei`
- `expires_at`

### 11.3 SponsoredExecutionRequest

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

### 11.4 PaymasterAuthorization

Suggested fields:

- `authorization_id`
- `sponsor_address`
- `sponsor_signer_type`
- `sponsor_nonce`
- `sponsor_expiry`
- `policy_hash`
- `sponsor_sig`

### 11.5 SponsoredExecutionReceipt

Suggested fields:

- `execution_id`
- `wallet_address`
- `sponsor_address`
- `provider_address`
- `request_hash`
- `submitted_tx_hash`
- `validation_cost_wei`
- `execution_cost_wei`
- `status`
- `submitted_at`
- `confirmed_at`
- `error`

## 12. Execution Flows

### Flow A: Local Wallet + Paymaster-Provider

1. Requester prepares a wallet call locally.
2. Requester discovers a paymaster-provider and requests a quote.
3. Paymaster-provider authorizes sponsorship for that exact request.
4. Requester or relay submits a sponsor-aware native transaction.
5. Protocol validates both wallet authorization and sponsor authorization.
6. Sponsor side pays validation and execution cost.
7. OpenFox persists a sponsorship receipt.

### Flow B: Signer-Provider + Paymaster-Provider

1. Requester obtains delegated execution authorization through signer-provider.
2. Requester obtains sponsorship authorization through paymaster-provider.
3. One side submits the sponsored transaction.
4. Protocol validates both execution and sponsorship witnesses.
5. The wallet authorizes the action; the sponsor pays the chain cost.
6. OpenFox persists both execution and sponsorship receipts.

### Flow C: Combined Provider

One provider offers both bounded execution and bounded sponsorship for a narrow automation loop.
This is useful for tightly scoped operational tasks, but it should still keep signing policy and sponsorship policy logically separate.

## 13. Naming Rules

The naming rule mirrors signer-provider:

- protocol objects stay chain-neutral where possible
- native chain internals may use `TOS`-specific naming

Recommended protocol names:

- `PaymasterPolicyRef`
- `PaymasterQuote`
- `PaymasterAuthorization`
- `SponsoredExecutionReceipt`

Avoid names that collapse protocol objects into chain branding unnecessarily, such as:

- `TosPaymasterQuote`
- `tos_sponsor_request`
- `TosSponsoredExecutionReceipt`

## 14. v0 Scope

Included:

- native sponsored transaction support in `gtos`
- first-class sponsor validation semantics
- OpenFox paymaster-provider discovery and authorization flow
- durable sponsorship receipts
- combined use with local wallets or signer-provider

Explicitly not included:

- a fake top-up-first workaround marketed as paymaster support
- full ERC-4337 compatibility goals
- backward-compatibility shims for current sender-pays-only flows
- threshold sponsor committees
- cross-chain sponsor routing
- generalized credit markets

## 15. Acceptance Criteria

`Paymaster-Provider v0` is successful when:

- a wallet with insufficient own `TOS` can still execute a sponsored transaction
- the sponsor side is charged for validation and execution cost
- sponsorship is rejected when sponsor policy does not allow the request
- replaying a sponsor authorization fails cleanly
- OpenFox can discover a paymaster-provider, obtain sponsorship, and persist a durable receipt
- sponsored execution composes cleanly with signer-provider flows

## 16. Relationship to the Broader Roadmap

Signer-provider and paymaster-provider together form the real programmable execution stack for OpenFox:

- signer-provider controls execution authority
- paymaster-provider controls execution funding

Without both, OpenFox can only delegate part of the lifecycle.
With both, OpenFox can support bounded agent execution as a real network-native economic primitive.
