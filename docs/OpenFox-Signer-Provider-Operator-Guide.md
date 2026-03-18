# OpenFox Signer-Provider Operator Guide

## Purpose

This guide explains how to run signer-provider v0 as part of the normal
OpenFox operator workflow.

Signer-provider v0 is the first bounded delegated-execution surface in
OpenFox. It is not a raw arbitrary-byte signing service and it is not a
custodial hosted-wallet product.

The provider accepts one constrained execution request, validates it against a
local policy, optionally charges through `x402`, submits the call to `TOS`,
and stores a durable execution receipt.

## Roles

### Principal

The owner of the programmable wallet or delegated execution policy.

Responsibilities:

- define the wallet policy boundary
- fund the wallet if execution requires native `TOS`
- choose the provider trust tier
- decide whether a provider may be public or private

### Signer-Provider

The OpenFox node that serves signer requests.

Responsibilities:

- publish `signer.quote`, `signer.submit`, `signer.status`, and
  `signer.receipt`
- enforce the configured wallet-policy boundary
- bind accepted payments to signer execution receipts
- persist recent signer quote and execution history

### Requester

The OpenFox node that wants one delegated execution.

Responsibilities:

- discover or choose a provider
- optionally require a `trust_tier`
- request a quote
- submit one bounded execution request
- inspect status and receipt

## Trust Tiers

Signer-provider v0 uses three trust tiers:

- `self_hosted`
- `org_trusted`
- `public_low_trust`

Recommended usage:

- use `self_hosted` for high-value or sensitive execution
- use `org_trusted` for team-operated or known third-party services
- use `public_low_trust` only for narrow, low-value, highly bounded execution

Requester commands can enforce the expected trust tier with `--trust-tier`.

## Minimal Provider Configuration

Add this to `~/.openfox/openfox.json` on the provider node:

```json
{
  "rpcUrl": "http://127.0.0.1:8545",
  "chainId": 1666,
  "x402Server": {
    "enabled": true,
    "confirmationPolicy": "receipt",
    "receiptTimeoutMs": 15000,
    "receiptPollIntervalMs": 1000,
    "retryBatchSize": 10,
    "retryAfterSeconds": 30,
    "maxAttempts": 5
  },
  "signerProvider": {
    "enabled": true,
    "bindHost": "127.0.0.1",
    "port": 4898,
    "pathPrefix": "/signer",
    "capabilityPrefix": "signer",
    "publishToDiscovery": true,
    "quoteValiditySeconds": 300,
    "quotePriceWei": "0",
    "submitPriceWei": "1000000000000000",
    "requestTimeoutMs": 15000,
    "maxDataBytes": 16384,
    "defaultGas": "180000",
    "policy": {
      "trustTier": "self_hosted",
      "policyId": "wallet-maintenance-v1",
      "walletAddress": "0x...",
      "delegateIdentity": "principal:ops",
      "allowedTargets": ["0x..."],
      "allowedFunctionSelectors": ["0x12345678"],
      "maxValueWei": "0",
      "allowSystemAction": false
    }
  }
}
```

## Provider Runtime

Run the provider:

```bash
pnpm openfox --run
```

Check visibility:

```bash
pnpm openfox status --json
pnpm openfox doctor
pnpm openfox service status
```

Inspect signer activity:

```bash
pnpm openfox signer list --json
pnpm openfox signer get --execution <id>
```

## Requester Flow

Discover providers:

```bash
pnpm openfox signer discover --trust-tier self_hosted --json
```

Request a quote:

```bash
pnpm openfox signer quote \
  --trust-tier self_hosted \
  --target 0x... \
  --value-wei 0 \
  --data 0x12345678
```

Submit one delegated execution:

```bash
pnpm openfox signer submit \
  --trust-tier self_hosted \
  --quote-id <quote-id> \
  --target 0x... \
  --value-wei 0 \
  --data 0x12345678
```

Inspect the result:

```bash
pnpm openfox signer status --provider <base-url> --execution <id>
pnpm openfox signer receipt --provider <base-url> --execution <id>
```

## Gateway-Compatible Deployment

Signer-provider can sit behind Agent Gateway.

Recommended shape:

- one public OpenFox gateway node
- one private signer-provider node
- the provider connects out through `gatewayClient`
- discovery advertises the gateway-backed signer routes

This keeps the private signer-provider off the public Internet while still
allowing discovery-first requester flows.

## Multi-Node Example

### Node A: Principal + Private Signer-Provider

- keeps the policy and delegated execution boundary
- runs signer-provider
- optionally connects to a public gateway

### Node B: Public Gateway

- runs OpenFox gateway
- relays signer quote/submit/status/receipt routes
- exposes the provider without revealing the private node

### Node C: Requester

- discovers `signer.quote`
- filters by `trust_tier`
- pays through `x402`
- submits one bounded execution

## Operator Warnings

- signer-provider v0 assumes the wallet already has enough native `TOS`
- signer-provider v0 is execution-centric, not generic signing-as-a-service
- do not expose `public_low_trust` providers to wide targets or large value caps
- keep `allowedTargets`, `allowedFunctionSelectors`, `maxValueWei`, and
  `expiresAt` narrow by default

## Related Docs

- [OpenFox-Signer-Provider-v0.md](./OpenFox-Signer-Provider-v0.md)
- [ROADMAP.md](./ROADMAP.md)
- [TASKS.md](./TASKS.md)
