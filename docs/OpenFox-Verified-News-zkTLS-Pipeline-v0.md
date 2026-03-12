# OpenFox Verified News Pipeline: SNARK over M-of-N LLMs over zk-TLSes

**Version:** 0
**Status:** Design

## Overview

This document describes the end-to-end pipeline for publishing cryptographically verified news on the TOS blockchain. The core idea is that multiple independent AI agents each fetch the same news article via TLSNotary zk-TLS, independently analyze it, and reach M-of-N consensus before publishing an on-chain record that anyone can verify or challenge.

The pipeline eliminates trust in any single agent, news source, or intermediary. Each step produces cryptographic evidence that can be independently verified.

## Architecture

```
                         ┌──────────────┐
                         │  News Sites  │
                         │ (HTTPS/TLS)  │
                         └──┬───┬───┬───┘
                            │   │   │
              ┌─────────────┘   │   └─────────────┐
              ▼                 ▼                  ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   LLM Agent A    │ │   LLM Agent B    │ │   LLM Agent C    │
│  (small model)   │ │  (small model)   │ │  (small model)   │
│                  │ │                  │ │                  │
│ ① Fetch article  │ │ ① Fetch article  │ │ ① Fetch article  │
│    via MPC-TLS   │ │    via MPC-TLS   │ │    via MPC-TLS   │
│                  │ │                  │ │                  │
│ ② TLSNotary      │ │ ② TLSNotary      │ │ ② TLSNotary      │
│    prove()       │ │    prove()       │ │    prove()       │
│    ┌──────────┐  │ │    ┌──────────┐  │ │    ┌──────────┐  │
│    │ Notary A │  │ │    │ Notary B │  │ │    │ Notary C │  │
│    │ (2PC co- │  │ │    │ (2PC co- │  │ │    │ (2PC co- │  │
│    │  signer) │  │ │    │  signer) │  │ │    │  signer) │  │
│    └──────────┘  │ │    └──────────┘  │ │    └──────────┘  │
│                  │ │                  │ │                  │
│ ③ LLM analyzes  │ │ ③ LLM analyzes   │ │ ③ LLM analyzes   │
│    article text  │ │    article text   │ │    article text   │
│    extracts      │ │    extracts       │ │    extracts       │
│    summary +     │ │    summary +      │ │    summary +      │
│    verdict       │ │    verdict        │ │    verdict        │
│                  │ │                  │ │                  │
│ Output:          │ │ Output:          │ │ Output:          │
│  attestation_A   │ │  attestation_B   │ │  attestation_C   │
│  summary_A       │ │  summary_B       │ │  summary_C       │
│  verdict_A       │ │  verdict_B       │ │  verdict_C       │
└────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
         │                    │                     │
         └────────────┬───────┴──────────┬──────────┘
                      ▼                  │
         ┌────────────────────────┐      │
         │  ④ M-of-N Aggregation  │◄─────┘
         │                        │
         │  Collect N attestations│
         │  Check ≥M agree        │
         │                        │
         │  Bundle:               │
         │   attestations[]       │
         │   consensus: M/N       │
         │   bundle_sha256        │
         └───────────┬────────────┘
                     │
                     ▼
         ┌────────────────────────┐
         │  ⑤ Publish to TOS      │
         │                        │
         │  tx.data = {           │
         │    bundle_sha256,      │
         │    attestations[],     │
         │    consensus: "3/5",   │
         │    source_url,         │
         │    verdict,            │
         │    summary             │
         │  }                     │
         │                        │
         │  Signed with Schnorr   │
         │  + Pedersen commitment │
         │  + BalanceProof        │
         └───────────┬────────────┘
                     │
                     ▼
    ═══════════════════════════════════════
    ║         TOS Blockchain (L1)        ║
    ║                                     ║
    ║  Block #N:                          ║
    ║  ┌─────────────────────────────┐    ║
    ║  │ ProofMarketRecord           │    ║
    ║  │  bundle_sha256: 0xabc...    │    ║
    ║  │  verifier_refs: [tlsn...]   │    ║
    ║  │  consensus: 3/5             │    ║
    ║  │  challenge_window: 24h      │    ║
    ║  └─────────────────────────────┘    ║
    ═══════════════════════════════════════
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
┌──────────────────┐  ┌──────────────────────┐
│ ⑥ Verifier Agent │  │ ⑦ Challenger Agent    │
│                  │  │                      │
│ Read on-chain    │  │ Within challenge     │
│ record           │  │ window:              │
│                  │  │                      │
│ Download bundle  │  │ Independently fetch  │
│                  │  │ same URL via zk-TLS  │
│ Verify:          │  │                      │
│  ✓ attestation   │  │ Compare results:     │
│    structure     │  │  ✗ mismatch →        │
│  ✓ bundle hash   │  │    submit dispute tx │
│  ✓ M-of-N valid  │  │  ✓ match →           │
│  ✓ server_name   │  │    confirm valid     │
│    whitelisted   │  │                      │
│                  │  │ Stake mechanism:      │
│ verdict: valid ✓ │  │  win → reward        │
│                  │  │  lose → slashed      │
└──────────────────┘  └──────────────────────┘
```

## Pipeline Steps

### Step 1: Parallel Fetch via MPC-TLS

N independent LLM agents each fetch the same news article URL. Each agent uses a separate TLSNotary notary as a 2-party computation co-signer. The notary participates in the TLS handshake via MPC — it helps compute the session keys but never sees the plaintext. This proves the response genuinely came from the target HTTPS server.

Each agent connects to:
- A **notary** (verifier co-party) over TCP
- The **target news server** over HTTPS via MPC-TLS

The notary and agent jointly compute the TLS session keys using garbled circuits and oblivious transfer. Neither party alone can decrypt the traffic.

**Skill:** `zktls.prove` (backed by `openskills-zktls` native module wrapping `tlsn` crate)

### Step 2: Generate zk-TLS Attestation

After the HTTP exchange completes, each agent transitions to the proving phase. The prover selectively discloses chosen portions of the TLS transcript (e.g., the HTTP response body) and generates a `ProverOutput` containing:

- **Transcript commitments** — cryptographic commitments to the sent/received data
- **Transcript secrets** — the opening values for selective disclosure
- **Server identity** — the TLS certificate chain and server signature, proving which server was contacted

The attestation is deterministic and serializable as JSON.

**Skill:** `zktls.prove` → `ProverOutput` (serialized as `attestation` JSON)

### Step 3: LLM Analysis

Each agent independently runs its LLM on the fetched article text to produce:

- **Summary** — a concise description of the article content
- **Verdict** — the agent's assessment (e.g., factual, opinion, misleading)
- **Extracted fields** — headline, publisher, publication date, key claims

Different agents may use different small LLMs, but all operate on the same TLS-proven content. This is the "M-of-N small LLMs" layer — no single model is trusted.

### Step 4: M-of-N Aggregation

An aggregator collects all N attestations and LLM outputs. It checks:

1. All attestations reference the same `server_name` and URL
2. The article content hashes match across attestations (same content was fetched)
3. At least M out of N agents produced consistent verdicts/summaries

If consensus is reached, the aggregator bundles everything into a single evidence package:

```json
{
  "format": "zktls_bundle_v1",
  "consensus": "3/5",
  "source_url": "https://news.example.com/article",
  "attestations": ["attestation_A", "attestation_B", "attestation_C"],
  "verdicts": ["factual", "factual", "factual"],
  "summary": "...",
  "bundle_sha256": "0x..."
}
```

**Skill:** `zktls.bundle` (deterministic JSON packaging + SHA-256 digest)

### Step 5: Publish to TOS Blockchain

The aggregated bundle is submitted as a transaction to the TOS L1 chain. The transaction includes:

- The `bundle_sha256` as a compact on-chain commitment
- Verifier material references pointing to the full attestation data (stored off-chain, e.g., IPFS)
- A `challenge_window` duration (e.g., 24 hours) during which the record can be disputed

The transaction is signed using the TOS Schnorr signature scheme (Ristretto255). For confidential operations, Pedersen commitments and BalanceProofs protect sensitive values.

**Skills:** `crypto-schnorr` (signing), `crypto-uno-proofs` (confidential tx), `crypto-rangeproofs` (Bulletproofs)

### Step 6: Verification

Any party can verify the published record:

1. Read the `ProofMarketRecord` from the chain
2. Download the full bundle from IPFS or the declared URL
3. Recompute `SHA-256(bundle)` and compare against the on-chain `bundle_sha256`
4. Deserialize each attestation and validate its structure
5. Check that M-of-N consensus was genuinely reached
6. Verify that `server_name` is in the allowed news source whitelist

**Skills:** `proofverify.verify` (hash comparison), `zktls.verify-attestation` (attestation structure)

### Step 7: Challenge

Within the challenge window, any agent can dispute the record by:

1. Independently fetching the same URL via zk-TLS (`zktls.prove`)
2. Comparing the fetched content against the bundle's `article_sha256`
3. If the content differs (e.g., the article was altered or the original attestation was fraudulent), submitting a **dispute transaction** with their own attestation as counter-evidence

The challenge mechanism uses a stake-based incentive:

| Outcome | Challenger | Publisher |
|---------|-----------|-----------|
| Challenge succeeds (content mismatch proven) | Receives reward from publisher's stake | Loses stake |
| Challenge fails (content matches) | Loses challenge deposit | Retains stake |

This creates an economic incentive for honest reporting and discourages false claims.

## Trust Model

| Component | Trust assumption |
|-----------|-----------------|
| News server | Trusted to serve consistent content over TLS (enforced by certificate pinning) |
| Individual LLM agent | **Not trusted** — any single agent may be compromised or biased |
| Individual notary | **Not trusted** — colluding notary + agent cannot forge TLS proofs from other servers |
| M-of-N consensus | Trusted if fewer than N-M+1 agents are colluding |
| TOS blockchain | Trusted for ordering and finality (standard L1 assumption) |
| TLSNotary protocol | Trusted for MPC-TLS correctness (audited, open-source) |

The key insight: even if a minority of agents or notaries are compromised, the M-of-N threshold ensures the published verdict reflects genuine consensus. The challenge window provides a second layer of defense against coordinated attacks.

## OpenSkills Integration

The entire pipeline is built on skills from the `openskills` repository:

| Pipeline stage | Skill | Backend | Implementation |
|---------------|-------|---------|----------------|
| Fetch + Prove | `zktls` | `prove` | Native module (`tlsn` crate via napi-rs) |
| Verify attestation | `zktls` | `verify-attestation` | Native module |
| Bundle evidence | `zktls` | `bundle` | Pure JS (SHA-256) |
| Verify bundle | `proofverify` | `verify` | Pure JS (hash comparison) |
| Transaction signing | `crypto-schnorr` | `sign` | Native (Ristretto255) |
| Confidential values | `crypto-uno-proofs` | `verify` | Native (Pedersen/ElGamal) |
| Range proofs | `crypto-rangeproofs` | `verify` | Native (Bulletproofs) |
| Hashing | `crypto-hash` | `hash` | Pure JS (SHA-256/Keccak) |
| Key exchange | `crypto-x25519` | `exchange` | Pure JS (ECDH) |
| Encoding | `crypto-encoding` | `encode`/`decode` | Pure JS (Base58/Base64) |

### Building the Native Module

```bash
cd ~/openskills/native
npm install
npm run build
# Produces: openskills-zktls.linux-x64-gnu.node (17MB)
```

The native module compiles the TLSNotary `tlsn` v0.1.0-alpha.14 Rust crate into a Node.js addon via napi-rs. It exposes two async functions: `prove()` for generating zk-TLS attestations and `verify()` for offline attestation validation.

## Example: Single Agent Prove Flow

```javascript
import { run as prove } from "openskills/skills/zktls/scripts/prove.mjs";

const result = await prove({
  request: {
    serverHost: "api.nytimes.com",
    notaryHost: "notary.openfox.im",
    notaryPort: 7047,
    method: "GET",
    path: "/svc/topstories/v2/home.json",
    headers: [{ name: "Accept", value: "application/json" }],
    maxRecvData: 16384,
  },
});

// result.attestation    — serialized ProverOutput JSON
// result.attestationSha256 — 0x-prefixed SHA-256
// result.serverName     — "api.nytimes.com"
// result.sentLen        — bytes sent
// result.recvLen        — bytes received
```

## Example: Verify + Challenge Flow

```javascript
import { run as verifyBundle } from "openskills/skills/proofverify/scripts/verify.mjs";
import { run as prove } from "openskills/skills/zktls/scripts/prove.mjs";

// 1. Verify existing bundle from chain
const verification = verifyBundle({
  request: {
    subject_sha256: onChainRecord.article_sha256,
    proof_bundle: downloadedBundle,
    proof_bundle_sha256: onChainRecord.bundle_sha256,
  },
});

if (verification.verdict === "invalid") {
  // 2. Generate counter-evidence
  const counterProof = await prove({
    request: {
      serverHost: onChainRecord.server_name,
      notaryHost: "notary.challenger.im",
      method: "GET",
      path: onChainRecord.article_path,
    },
  });

  // 3. Submit dispute transaction to TOS
  submitDisputeTx(onChainRecord.id, counterProof.attestation);
}
```

## Future Work

- **SNARK aggregation** — Replace the current M-of-N hash comparison with a SNARK circuit that proves "M of these N attestations are valid" in a single succinct proof, reducing on-chain verification cost.
- **Recursive SNARKs** — Compose zk-TLS proofs with LLM inference proofs (zkML) for end-to-end verifiable AI news analysis.
- **Decentralized notary network** — Run notaries as TOS validators so that the same stake secures both consensus and TLS attestation.
- **Cross-chain verification** — Export TOS proof records to Ethereum via BN254 pairing checks (EVM ecPairing precompile at 0x08).
