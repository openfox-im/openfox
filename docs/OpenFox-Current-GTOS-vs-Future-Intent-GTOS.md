# Current GTOS vs Future Intent GTOS

## 1. Goal

This document gives a clear side-by-side comparison between:

- the current `GTOS` architecture
- the future `Intent GTOS` architecture

The purpose is not to claim that current `GTOS` lacks agent-native features.
It already has them.

The purpose is to show the specific protocol shift required to move from a
transaction-native agent chain to a true intent-based blockchain.

## 2. Short Version

Current `GTOS` is:

- agent-native
- account-abstraction-aware
- delegated-execution-capable
- sponsor-aware
- still fundamentally transaction-native

Future `Intent GTOS` would be:

- agent-native
- solver-aware
- intent-state-aware
- fill-validation-aware
- protocol-native at the intent layer

## 3. Two-Column Comparison

| Current GTOS | Future Intent GTOS |
| --- | --- |
| Primary protocol object is the native transaction. | Primary user-facing protocol object is the signed intent. |
| Users or agents may think in intents, but the chain still settles a pre-built transaction path. | Users or agents submit constraints and desired outcome before the final path is chosen. |
| `OpenFox`, wallets, or signer-provider logic decide the final execution path before submission. | Solvers discover the intent, search paths, quote, and compete to satisfy it. |
| The protocol validates transaction legality: signature, gas, account rules, sponsor rules, and execution validity. | The protocol validates both transaction legality and intent satisfaction. |
| Delegated execution exists, but it is still delegated transaction execution. | Delegated execution becomes intent-driven fill execution. |
| Sponsorship is expressed as optional sponsor authorization on the native transaction. | Sponsorship still exists, but it is checked against the intent's sponsor requirements during fill validation. |
| Account abstraction validates whether the account approves the transaction. | Account abstraction still matters, but now the fill must also remain inside the signed intent boundary. |
| Current state is naturally transaction-centric. | State becomes intent-centric as well as transaction-centric. |
| The chain mainly tracks transaction inclusion and execution result. | The chain also tracks intent lifecycle: `open`, `filled`, `cancelled`, `expired`, and optionally `partially_filled`. |
| There is no first-class intent pool in the base protocol. | There is a first-class `intentpool` for propagation, lookup, and solver intake. |
| Discovery is already agent-capability-oriented. | Discovery extends to solver discovery, quote routing, and intent solving roles. |
| `tolang` publishes agent-native ABI, effects, and capability metadata. | `tolang` also publishes machine-readable `intent_surface` metadata for safe solver behavior. |
| Receipts are ordinary transaction receipts. | The system also indexes intent-aware receipts and fill outcomes. |
| Competition happens at the provider / signer / paymaster / application layer. | Competition becomes a protocol-recognized solver market around fills. |
| Failure semantics are mostly transaction failure semantics. | Failure semantics also include intent rejection, cancellation, expiry, overfill prevention, and partial-fill accounting. |
| The dominant mental model is: "build the right transaction, then send it." | The dominant mental model is: "sign the right intent, then let the network find a valid fill." |

## 4. The Core Difference

The biggest difference is not:

- agents vs no agents
- smart contracts vs no smart contracts
- account abstraction vs EOAs
- sponsorship vs no sponsorship

The biggest difference is:

- current `GTOS` treats intent mostly as an application-layer planning object
- future `Intent GTOS` treats intent as a protocol-level settlement object

That is the real architectural shift.

## 5. Execution Flow Comparison

### Current GTOS

```text
user objective
-> OpenFox / wallet / signer-provider interprets it
-> final transaction path is constructed
-> native transaction is signed
-> gtos validates transaction
-> settlement
```

### Future Intent GTOS

```text
user objective
-> OpenFox emits signed intent
-> intent enters intentpool
-> one or more solvers discover and quote it
-> a solver submits a fill transaction
-> gtos validates that the fill satisfies the intent
-> settlement + intent-aware receipt
```

## 6. What Stays the Same

Moving to `Intent GTOS` does not mean throwing away the current stack.

These remain valuable and should be preserved:

- one native transaction family
- account abstraction
- signer-provider and paymaster-provider patterns
- agent discovery and agent gateway
- `tolang` agent-native contract semantics
- `OpenFox` as the long-running requester / solver / operator runtime

The intent architecture builds on top of them.
It does not replace them.

## 7. What Must Be Added

To move from current `GTOS` to future `Intent GTOS`, the minimum missing pieces are:

- a first-class `IntentEnvelope`
- an `intentpool`
- intent-aware fill validation in `gtos`
- canonical intent lifecycle tracking
- solver discovery and quote flow
- `intent_surface` metadata in `tolang`
- intent-aware receipts and operator UX in `OpenFox`

## 8. One-Sentence Positioning

The cleanest way to describe the difference is:

Current `GTOS` is an agent-native blockchain that settles transactions chosen by
agents.

Future `Intent GTOS` is an agent-native blockchain that settles intents through
solver-selected transaction fills.
