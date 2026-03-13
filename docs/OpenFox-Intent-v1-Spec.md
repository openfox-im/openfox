# OpenFox Intent v1 Spec

Status: draft  
Audience: `gtos`, `tolang`, `tosdk`, and `OpenFox` implementers

## 1. Goal

This document defines the minimum concrete shape of Intent v1 for the current
stack.

The design choice for v1 is:

- keep one native transaction family in `gtos`
- add a first-class signed `IntentEnvelope`
- let solvers discover and quote intents off-chain
- settle a chosen fill through the ordinary native transaction path
- attach an `intent_auth` block to the fill transaction so `gtos` can validate
  the fill against the intent

This avoids introducing a second execution family while still making the
protocol intent-aware.

## 2. Non-Goals

Intent v1 does not attempt to provide:

- private orderflow by default
- encrypted intents
- cross-chain fill orchestration
- arbitrary on-chain satisfaction programs
- a universal auction protocol
- custom intent families for every application category

V1 only needs one canonical family:

- `ExecutionIntent`

## 3. Roles

- `principal`: the wallet or account contract whose objective is being executed
- `requester`: the runtime that authors and submits the intent, often `OpenFox`
- `solver`: the agent that computes a valid execution path and submits a fill
- `sponsor`: an optional fee payer or paymaster authority
- `watcher`: a runtime that observes intent state and fill outcomes

## 4. Canonical Objects

Intent v1 uses five canonical objects:

1. `ExecutionIntent`
2. `IntentEnvelope`
3. `IntentCancel`
4. `IntentAuth`
5. `IntentReceipt`

### 4.1 `ExecutionIntent`

`ExecutionIntent` is the unsigned semantic body.

Required fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | `u8` | Intent format version. V1 value is `1`. |
| `kind` | `string` | Must be `execution`. |
| `chain_id` | `u64` | Target chain ID. |
| `principal` | `address32` | The account whose policy and assets govern execution. |
| `requester` | `address32` | The runtime or agent that authored the request. |
| `nonce` | `u256` | Principal-scoped nonce. |
| `cancel_domain` | `bytes32` | Domain for nonce reuse and cancellation grouping. |
| `issued_at_ms` | `u64` | Creation timestamp in milliseconds. |
| `expires_at_ms` | `u64` | Expiry timestamp in milliseconds. |
| `fill_mode` | `enum` | `single_fill` or `partial_fill`. |
| `competition_mode` | `enum` | `private_rfq` or `open`. |
| `target` | `TargetSurface` | Contract surface the solver may satisfy. |
| `constraints` | `ExecutionConstraints` | Hard execution bounds. |
| `settlement` | `SettlementHints` | Receiver, refund, sponsor hints. |
| `payload` | `bytes` | Surface-specific encoded intent payload. |
| `metadata_uri` | `string` | Optional off-chain metadata pointer. |

### 4.2 `IntentEnvelope`

`IntentEnvelope` wraps `ExecutionIntent` with signer metadata.

Required fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `intent` | `ExecutionIntent` | Unsigned intent body. |
| `signer_type` | `string` | Uses the existing signer-type vocabulary from `gtos`. |
| `signature` | `bytes` | Signature over the canonical sign payload. |

### 4.3 `IntentCancel`

`IntentCancel` revokes a still-open intent or an entire nonce domain.

Required fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | `u8` | Cancellation format version. |
| `chain_id` | `u64` | Target chain ID. |
| `principal` | `address32` | Intent owner. |
| `cancel_domain` | `bytes32` | Domain being cancelled. |
| `nonce` | `u256` | Specific nonce being cancelled. |
| `intent_hash` | `bytes32` | Optional exact intent hash when cancelling one object only. |
| `issued_at_ms` | `u64` | Cancellation timestamp. |
| `signer_type` | `string` | Principal signer type. |
| `signature` | `bytes` | Signature over the cancellation payload. |

### 4.4 `IntentAuth`

`IntentAuth` is the authorization block embedded into the solver's fill
transaction.

It does not carry a second sponsor signature block. Sponsor authorization stays
in the native transaction envelope.

Required fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `intent_hash` | `bytes32` | Hash of the signed intent. |
| `principal` | `address32` | Principal address copied from the intent. |
| `solver` | `address32` | Solver identity attributed for the fill. |
| `fill_nonce` | `u64` | Per-fill dedup field. |
| `fill_amount` | `u256` | Requested fill amount or fraction numerator. |
| `fill_fraction_bps` | `u32` | Used only when `fill_mode = partial_fill`. |
| `max_solver_fee_wei` | `u256` | Solver-declared fee cap for this fill. |

### 4.5 `IntentReceipt`

`IntentReceipt` is the canonical intent-aware result object indexed by the
protocol.

Required fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `intent_hash` | `bytes32` | Intent identifier. |
| `status` | `enum` | `open`, `filled`, `partially_filled`, `cancelled`, `expired`, `rejected`. |
| `principal` | `address32` | Principal identity. |
| `solver` | `address32` | Winning or last successful solver. |
| `sponsor` | `address32` | Optional sponsor. |
| `fill_tx_hash` | `bytes32` | Native fill transaction hash. |
| `filled_amount` | `u256` | Amount credited to the fill. |
| `total_filled_amount` | `u256` | Aggregate fill amount so far. |
| `block_number` | `u64` | Inclusion block number. |
| `reason_code` | `string` | Empty on success; machine-readable code on rejection. |

## 5. Typed Substructures

### 5.1 `TargetSurface`

`TargetSurface` binds the intent to a contract surface published by `tolang`.

| Field | Type | Meaning |
| --- | --- | --- |
| `contract` | `address32` | Target contract address. |
| `surface_id` | `string` | Stable surface identifier from ABI/artifacts. |
| `surface_version` | `string` | Surface schema version. |
| `entrypoint` | `string` | Contract entrypoint name or selector label. |

### 5.2 `ExecutionConstraints`

| Field | Type | Meaning |
| --- | --- | --- |
| `max_input_amount` | `u256` | Maximum total input the solver may spend. |
| `min_output_amount` | `u256` | Minimum outcome the solver must deliver. |
| `max_total_fee_wei` | `u256` | Total fee cap across solver and sponsor-aware cost. |
| `max_slippage_bps` | `u32` | Upper slippage bound. |
| `max_gas_used` | `u64` | Hard gas limit for the fill. |
| `allow_partial_fill` | `bool` | Must agree with `fill_mode`. |
| `allowed_mutable_params` | `[]string` | Payload fields the solver may choose. |
| `required_capabilities` | `[]string` | Optional solver capability requirements. |

### 5.3 `SettlementHints`

| Field | Type | Meaning |
| --- | --- | --- |
| `beneficiary` | `address32` | Address receiving the requested outcome. |
| `refund_to` | `address32` | Address receiving refunds or unused funds. |
| `sponsor_mode` | `enum` | `forbidden`, `optional`, or `required`. |
| `sponsor` | `address32` | Optional preferred sponsor identity. |

## 6. Canonical Hashing and Signing

Intent v1 should use a canonical typed-binary sign payload, not ad hoc JSON
serialization.

Recommended rule:

- encode `ExecutionIntent` into a deterministic binary payload
- hash it with `keccak256`
- sign that hash with the same signer-type-aware framework already used by `gtos`

The `intent_hash` is:

```text
intent_hash = keccak256(EncodeExecutionIntent(intent))
```

The signed payload excludes:

- `signature`
- transport wrappers
- local quote metadata

The same signer-type support expected for native execution should also be
accepted for intent signatures.

## 7. Intent State Machine

The canonical state machine is:

```text
open -> filled
open -> partially_filled
open -> cancelled
open -> expired
partially_filled -> partially_filled
partially_filled -> filled
partially_filled -> cancelled
partially_filled -> expired
```

Invalid transitions must be rejected by the protocol.

## 8. Validation Rules in `gtos`

When a solver submits a fill transaction with `intent_auth`, `gtos` must verify:

1. the intent exists or is supplied in a protocol-accepted retrievable form
2. `chain_id` matches the local chain
3. the intent signature is valid
4. the intent is not expired
5. the intent is not cancelled
6. the intent has remaining fill capacity
7. the fill transaction targets the `target.surface_id` contract surface
8. the solver only changed parameters listed in `allowed_mutable_params`
9. realized input, output, fee, and gas values remain within hard bounds
10. sponsor usage matches `settlement.sponsor_mode` using the transaction's
    native sponsor authorization fields
11. the resulting fill does not overfill the intent

If any of these checks fail, the fill is rejected and the receipt reason code
should be explicit.

## 9. `tolang` ABI and Artifact Requirements

Intent v1 depends on `tolang` publishing a machine-readable `intent_surface`
object for each fillable surface.

Minimum fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Stable surface ID. |
| `entrypoint` | `string` | Function or entrypoint name. |
| `fill_mode` | `enum` | `quote_only`, `single_fill`, `partial_fill`. |
| `mutable_params` | `[]string` | Parameters the solver may choose. |
| `hard_bounds_schema` | `object` | Schema of bounds that must be checked. |
| `effects` | `[]string` | Effect summary already aligned with existing metadata. |
| `receipt_events` | `[]string` | Events that watchers use for confirmation. |
| `required_capabilities` | `[]string` | Optional principal or solver capability list. |

Suggested JSON shape inside `.toc`:

```json
{
  "intent_surfaces": [
    {
      "id": "swap.exact_in",
      "entrypoint": "swapExactIn",
      "fill_mode": "single_fill",
      "mutable_params": ["route", "solver_fee_bps"],
      "hard_bounds_schema": {
        "max_input_amount": "u256",
        "min_output_amount": "u256",
        "max_slippage_bps": "u32"
      },
      "effects": [
        "writes:balances[beneficiary]",
        "emits:SwapSettled(agent,u256,u256)"
      ],
      "receipt_events": ["SwapSettled"],
      "required_capabilities": []
    }
  ]
}
```

## 10. JSON-RPC Surface

Intent v1 should add the following RPC methods.

### 10.1 `tos_sendIntent`

Submit a signed `IntentEnvelope` to the local node's intentpool.

Params:

- `intent_envelope`

Returns:

- `intent_hash`

### 10.2 `tos_getIntent`

Get the envelope and the latest indexed state.

Params:

- `intent_hash`

Returns:

- `intent_envelope`
- `status`
- `latest_receipt`

### 10.3 `tos_intentStatus`

Get a compact state response.

Params:

- `intent_hash`

Returns:

- `status`
- `remaining_fill`
- `expires_at_ms`
- `last_fill_tx_hash`

### 10.4 `tos_cancelIntent`

Submit a signed `IntentCancel`.

Params:

- `intent_cancel`

Returns:

- `cancel_hash`

### 10.5 `tos_estimateIntent`

Run local static checks and simulation helpers without publishing the intent.

Params:

- `intent_envelope`

Returns:

- `is_well_formed`
- `estimated_gas`
- `required_capabilities`
- `surface_id`
- `warnings`

## 11. Example `IntentEnvelope`

```json
{
  "intent": {
    "version": 1,
    "kind": "execution",
    "chain_id": 1666,
    "principal": "0x1111...",
    "requester": "0x2222...",
    "nonce": "42",
    "cancel_domain": "0x7061796d656e7473000000000000000000000000000000000000000000000000",
    "issued_at_ms": 1770000000000,
    "expires_at_ms": 1770000060000,
    "fill_mode": "single_fill",
    "competition_mode": "open",
    "target": {
      "contract": "0x3333...",
      "surface_id": "swap.exact_in",
      "surface_version": "1.0.0",
      "entrypoint": "swapExactIn"
    },
    "constraints": {
      "max_input_amount": "1000000000000000000",
      "min_output_amount": "2500000",
      "max_total_fee_wei": "5000000000000000",
      "max_slippage_bps": 100,
      "max_gas_used": 500000,
      "allow_partial_fill": false,
      "allowed_mutable_params": ["route", "solver_fee_bps"],
      "required_capabilities": []
    },
    "settlement": {
      "beneficiary": "0x1111...",
      "refund_to": "0x1111...",
      "sponsor_mode": "optional",
      "sponsor": "0x4444..."
    },
    "payload": "0xabcdef",
    "metadata_uri": "ipfs://example"
  },
  "signer_type": "secp256k1",
  "signature": "0xdeadbeef"
}
```

## 12. Example `IntentAuth`

```json
{
  "intent_hash": "0xaaaa...",
  "principal": "0x1111...",
  "solver": "0x5555...",
  "fill_nonce": 1,
  "fill_amount": "1000000000000000000",
  "fill_fraction_bps": 10000,
  "max_solver_fee_wei": "2000000000000000"
}
```

## 13. OpenFox Runtime Expectations

`OpenFox` should use this spec in four modes:

- requester mode: author and submit intents
- solver mode: discover intents, simulate paths, and submit fills
- sponsor mode: issue bounded sponsorship authorizations for fills
- watcher mode: track intent states, receipts, solver performance, and failures

`OpenFox` quote records and internal solver heuristics are intentionally not part
of the protocol spec.

## 14. Recommended v1 Decision

For v1, the stack should explicitly choose:

- `IntentEnvelope` as the canonical off-chain intent object
- `intent_auth` as an extension block on the native transaction envelope
- `intent_surface` metadata in `tolang` artifacts
- `tos_sendIntent` / `tos_getIntent` / `tos_cancelIntent` / `tos_intentStatus`
  / `tos_estimateIntent` as the base RPC surface

That is the minimum coherent spec that upgrades the stack from transaction-native
delegated execution to intent-aware settlement without overbuilding the first
version.
