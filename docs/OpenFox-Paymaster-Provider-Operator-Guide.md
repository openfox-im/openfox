# OpenFox Paymaster-Provider Operator Guide

## Purpose

This guide explains how to run paymaster-provider v0 as part of the normal
OpenFox operator workflow.

Paymaster-provider v0 is the first native sponsored-execution funding surface
in OpenFox. It is not a faucet, and it is not an ERC-4337-style generic
paymaster abstraction. The provider evaluates one bounded sponsorship request,
funds the execution from a sponsor account when policy allows it, and returns a
durable authorization record and receipt.

## Roles

### Requester

The OpenFox node that wants one sponsored execution.

Responsibilities:

- discover or choose a paymaster-provider
- request a bounded sponsorship quote
- pay through `x402` when the provider charges for authorization
- submit one bounded authorization request
- inspect authorization status and receipt

### Sponsor Principal

The operator that owns or controls the sponsor account and policy.

Responsibilities:

- define the sponsorship boundary
- fund the sponsor account with enough native `TOS`
- choose the provider trust tier
- decide whether the provider is private, team-operated, or public

### Paymaster-Provider

The OpenFox node that serves sponsorship requests.

Responsibilities:

- publish `paymaster.quote`, `paymaster.authorize`, `paymaster.status`, and
  `paymaster.receipt`
- enforce the configured sponsor-policy boundary
- bind accepted payments to authorization records
- sign and submit one native sponsored transaction
- persist recent quote and authorization history

## Trust Tiers

Paymaster-provider v0 uses the same trust tiers as signer-provider:

- `self_hosted`
- `org_trusted`
- `public_low_trust`

Recommended usage:

- use `self_hosted` for high-value or sensitive sponsored execution
- use `org_trusted` for team-operated or known third-party providers
- use `public_low_trust` only for narrow, low-value, tightly bounded funding

Requester commands can enforce the expected trust tier with `--trust-tier`.

## Minimal Provider Configuration

Add this to `~/.openfox/openfox.json` on the paymaster-provider node:

```json
{
  "rpcUrl": "http://127.0.0.1:8545",
  "chainId": 1666,
  "walletAddress": "0x...",
  "x402Server": {
    "enabled": true,
    "confirmationPolicy": "receipt",
    "receiptTimeoutMs": 15000,
    "receiptPollIntervalMs": 1000,
    "retryBatchSize": 10,
    "retryAfterSeconds": 30,
    "maxAttempts": 5
  },
  "paymasterProvider": {
    "enabled": true,
    "bindHost": "127.0.0.1",
    "port": 4899,
    "pathPrefix": "/paymaster",
    "capabilityPrefix": "paymaster",
    "publishToDiscovery": true,
    "quoteValiditySeconds": 300,
    "authorizationValiditySeconds": 300,
    "quotePriceWei": "0",
    "authorizePriceWei": "1000000000000000",
    "requestTimeoutMs": 15000,
    "maxDataBytes": 16384,
    "defaultGas": "180000",
    "policy": {
      "trustTier": "self_hosted",
      "policyId": "sponsored-maintenance-v1",
      "sponsorAddress": "0x...",
      "delegateIdentity": "ops:paymaster",
      "allowedWallets": ["0x..."],
      "allowedTargets": ["0x..."],
      "allowedFunctionSelectors": ["0x12345678"],
      "maxValueWei": "0",
      "allowSystemAction": false
    }
  }
}
```

Important notes:

- `walletAddress` is the local native wallet used by the OpenFox node itself
- `policy.sponsorAddress` is the sponsor account that pays for sponsored
  execution
- `allowedWallets`, `allowedTargets`, and `allowedFunctionSelectors` should stay
  narrow by default
- keep `authorizePriceWei` small if the provider is intended for low-friction
  operator flows

## Provider Runtime

Run the provider:

```bash
pnpm openfox --run
```

Check provider visibility:

```bash
pnpm openfox status --json
pnpm openfox doctor
pnpm openfox service status
```

Inspect local quote and authorization history:

```bash
pnpm openfox paymaster list --kind quote --json
pnpm openfox paymaster list --kind authorization --json
pnpm openfox paymaster get --quote <quote-id>
pnpm openfox paymaster get --authorization <authorization-id>
```

## Requester Flow

Discover providers:

```bash
pnpm openfox paymaster discover --trust-tier self_hosted --json
```

Request one sponsorship quote:

```bash
pnpm openfox paymaster quote \
  --trust-tier self_hosted \
  --target 0x... \
  --value-wei 0 \
  --data 0x12345678
```

Authorize one bounded sponsored execution:

```bash
pnpm openfox paymaster authorize \
  --trust-tier self_hosted \
  --quote-id <quote-id>
```

Inspect the remote authorization:

```bash
pnpm openfox paymaster status --provider <base-url> --authorization <authorization-id>
pnpm openfox paymaster receipt --provider <base-url> --authorization <authorization-id>
```

## Multi-Node Composition

### Node A: Sponsor Principal + Private Paymaster-Provider

- keeps the sponsor policy and sponsor key material
- runs paymaster-provider
- optionally connects out through Agent Gateway

### Node B: Public Gateway

- runs OpenFox gateway
- relays `paymaster.quote`, `paymaster.authorize`, `paymaster.status`, and
  `paymaster.receipt`
- exposes the private provider without exposing the node directly

### Node C: Requester

- discovers `paymaster.quote`
- filters by `trust_tier`
- pays through `x402` when required
- submits one bounded sponsorship authorization

### Optional Node D: Signer-Provider

If the operator wants both delegated authority and delegated funding, signer and
paymaster roles may be combined or composed across nodes:

- requester -> signer-provider for bounded authority
- requester -> paymaster-provider for bounded funding
- requester -> combined signer-provider + paymaster-provider when one operator
  controls both surfaces

## Current Signer Parity Boundary

Paymaster-provider v0 uses native sponsored execution. At the current stage,
the practical requester/sponsor signer surface in OpenFox is still
`secp256k1`.

That means:

- native sponsored execution is supported
- requester and sponsor signer types are exposed in authorization records
- operators can inspect signer parity through `openfox status`, `openfox
  doctor`, and paymaster receipt/status responses
- non-`secp256k1` sponsored execution should still be treated as future work,
  not an operator assumption

If you need stronger guarantees, prefer:

- `self_hosted` trust tier
- narrow policy scope
- local validation of requester and sponsor signer types

## Operator Warnings

- paymaster-provider v0 is not a generic top-up substitute
- do not use a public provider with wide wallet or target allowlists
- keep policy windows, value caps, and selector allowlists narrow
- keep the sponsor account funded and monitor failed authorizations
- use `openfox doctor` regularly to confirm sponsor-policy state and signer
  parity

## Related Docs

- [OpenFox-Paymaster-Provider-v0.md](./OpenFox-Paymaster-Provider-v0.md)
- [OpenFox-Signer-Provider-Operator-Guide.md](./OpenFox-Signer-Provider-Operator-Guide.md)
- [ROADMAP.md](./ROADMAP.md)
- [TASKS.md](./TASKS.md)
