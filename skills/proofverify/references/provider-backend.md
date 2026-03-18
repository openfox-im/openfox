# Provider Backend Contracts

## Stage: `proofverify.verify`

Contract JSON: `verify-contract.json`
Version: `v1`

Input:

- `request.subject_url` or `request.subject_sha256`
- `request.proof_bundle_url` or `request.proof_bundle_sha256`
- `options.allowPrivateTargets`
- `options.requestTimeoutMs`
- `options.maxFetchBytes`

Output:

- `verdict` — `valid` | `invalid` | `inconclusive`
- `verdictReason`
- `summary`
- `metadata`
- `verifierReceiptSha256`

## Stage: `proofverify.verify-attestations`

Contract JSON: `verify-attestations-contract.json` (in openskills/proofverify/references/)
Version: `v1`

Validates TLSNotary attestation cryptographic structure via native module. Supports dual-path verification: cryptographic (Presentation format with full signature/Merkle proof validation) or structural (ProverOutput format with commitment count check).

Input:

- `request.attestations` — `string[]` (required) — serialized attestation JSONs
- `request.expectedServerName` — `string` (optional) — hostname all attestations must match
- `request.serverNameWhitelist` — `string[]` (optional) — allowed server hostnames
- `request.expectedArticleSha256` — `string` (optional) — expected content hash

Output:

- `verdict` — `valid` | `invalid` | `inconclusive`
- `verdictReason` — `all_attestations_valid` | `attestation_check_failed` | `no_checks_available`
- `summary`
- `metadata.total_attestations`
- `metadata.valid_attestations`
- `metadata.server_names` — unique server hostnames extracted from cryptographic verification
- `metadata.attestation_hashes`
- `metadata.checks[]` — `{ label, ok, actual, expected }`
- `metadata.results[]` — per-attestation `{ index, valid, commitmentCount, attestationSha256, verificationLevel, serverName }`
- `verifierReceiptSha256`

## Stage: `proofverify.verify-consensus`

Contract JSON: `verify-consensus-contract.json` (in openskills/proofverify/references/)
Version: `v1`

Pure JS M-of-N consensus checking across multiple agent attestation results.

Input:

- `request.m` — `number` (required) — minimum agreeing agents
- `request.n` — `number` (required) — total agents
- `request.agentResults` — `object[]` (required) — `[{ verdict, serverName?, articleSha256?, attestationSha256? }]`
- `request.expectedServerName` — `string` (optional)
- `request.expectedArticleSha256` — `string` (optional)

Output:

- `verdict` — `valid` | `invalid` | `inconclusive`
- `verdictReason` — `consensus_reached` | `consensus_not_reached` | `no_checks_available`
- `summary`
- `metadata.consensus` — e.g. `3/5`
- `metadata.threshold` — e.g. `3/5`
- `metadata.threshold_met` — `boolean`
- `metadata.majority_verdict` — the verdict with most agreement
- `metadata.verdict_distribution` — `{ factual: 3, misleading: 1, ... }`
- `metadata.checks[]` — `{ label, ok, actual, expected, details? }`
- `verifierReceiptSha256`
