# OpenFox CLI Worker Contracts v0

Status: draft

## 1. Purpose

This document defines the implementation contract for the next-stage `Phase 42`
and `Phase 43` backends:

- `zktls.bundle`
- `proofverify.verify`

The goal is to keep the OpenFox provider shell in TypeScript while moving the
cryptographic and compute-heavy work into external CLI workers implemented in
Rust, Go, or other strong systems languages.

This is the preferred v0 execution model for:

- stronger zkTLS evidence capture behind `news.fetch`
- stronger proof verification behind `proof.verify`

Preferred implementation direction:

- use Rust-first worker implementations
- prefer upstream TLSNotary `tlsn` crates for the first real `zktls.bundle`
  backend
- do not treat `tlsn-js` or `tlsn-wasm` as the primary Node.js integration
  path for v0

## 2. Scope

This document covers:

- the process contract between OpenFox and worker binaries
- stdin/stdout schemas
- exit code semantics
- execution bounds and safety rules
- how worker outputs map back into the existing provider shells

This document does not define:

- a long-running HTTP verifier service
- background worker daemons
- proving arbitrary LLM reasoning
- committee aggregation or public proof publication

Those belong to later phases.

## 3. Architectural Position

OpenFox keeps the stable outer provider shell:

- HTTP route and response schema
- x402 quote/payment handling
- request expiry, nonce handling, anti-replay, and idempotency
- durable persistence
- service status, `doctor`, and operator visibility

The worker binaries perform the heavy backend stage.

The intended execution shape is:

- `news.fetch -> newsfetch.capture -> zktls.bundle`
- `proof.verify -> proofverify.verify`

Where:

- `newsfetch.capture` can remain a bounded preflight stage
- `zktls.bundle` becomes the real cryptographic origin-proof stage
- `proofverify.verify` becomes the real cryptographic verifier stage

## 4. Why CLI Workers

CLI workers are the preferred first implementation because they:

- avoid introducing extra ports and service discovery
- reduce deployment complexity
- fit bounded request/response backend stages
- allow the core prover/verifier logic to be written in Rust or Go
- preserve one stable OpenFox provider protocol

This is especially important for TLSNotary integration because the Rust `tlsn`
core is the preferred backend target, while browser-oriented JS/WASM surfaces
are not the preferred server-side integration path for OpenFox provider
backends.

HTTP or daemonized workers may be added later if concurrency or shared prover
infrastructure requires it. They are not required for the first real backend.

## 5. Shared Worker Contract

### 5.1 Invocation Model

OpenFox invokes each worker as a child process.

Rules:

- request payload is written to `stdin` as one JSON document
- success result is written to `stdout` as one JSON document
- logs and diagnostics are written to `stderr`
- the worker must not require an interactive TTY
- the worker must exit after one request

### 5.2 Process Bounds

The OpenFox adapter must enforce:

- timeout
- maximum stdin payload size
- maximum stdout size
- bounded temporary directory usage
- bounded environment variable allowlist

The worker must assume it may be killed on timeout.

### 5.3 Versioning

Each worker contract is versioned.

Required top-level request fields:

```json
{
  "schema_version": "openfox.cli-worker.v1",
  "worker": "zktls.bundle"
}
```

or:

```json
{
  "schema_version": "openfox.cli-worker.v1",
  "worker": "proofverify.verify"
}
```

Required top-level success fields:

```json
{
  "schema_version": "openfox.cli-worker.v1",
  "worker": "zktls.bundle",
  "result": {}
}
```

The OpenFox adapter unwraps `result` and maps it into the existing backend
result parsers.

### 5.4 Exit Codes

The worker must use the following exit codes:

- `0`: success
- `10`: invalid input schema
- `11`: unsupported policy, source, or verifier class
- `20`: deterministic invalid result
- `21`: deterministic inconclusive result
- `30`: temporary external failure
- `40`: internal worker failure

OpenFox mapping:

- `10`, `11`: request rejected, no fallback to a different worker of the same class
- `20`, `21`: valid backend outcome, not infrastructure failure
- `30`: temporary backend failure, eligible for retry or configured fallback
- `40`: worker failed unexpectedly, eligible for operator alerting

## 6. Worker Execution Environment

Workers should be configured by explicit operator settings.

Suggested config shape:

```json
{
  "command": "zktls-bundler",
  "args": ["--mode", "bundle-v1"],
  "timeoutMs": 120000,
  "maxStdinBytes": 262144,
  "maxStdoutBytes": 1048576,
  "env": {
    "ZKTLS_PROFILE": "news-default"
  }
}
```

The same shape applies to `proofverify.verify`.

Rules:

- command path must be explicit or resolvable from `PATH`
- environment variables must be explicitly allowlisted
- workers must not rely on user-specific hardcoded home paths
- large artifacts should be passed as durable refs or temp file paths, not
  embedded as arbitrarily large inline blobs

## 7. `zktls.bundle` Contract

### 7.1 Role

`zktls.bundle` is the real origin-proof stage behind `news.fetch`.

It should:

- perform or finalize bounded cryptographic capture
- produce a durable proof bundle
- bind the normalized result to the captured source material
- return enough metadata for later verification and committee use

### 7.2 Input Schema

Input:

```json
{
  "schema_version": "openfox.cli-worker.v1",
  "worker": "zktls.bundle",
  "request_id": "req_...",
  "request": {
    "capability": "news.fetch",
    "source_url": "https://example.com/story",
    "requester": {
      "identity": {
        "kind": "tos",
        "value": "0x..."
      }
    },
    "request_nonce": "nonce_...",
    "request_expires_at": 1773273600
  },
  "capture": {
    "canonicalUrl": "https://example.com/story",
    "httpStatus": 200,
    "contentType": "text/html",
    "articleSha256": "0x...",
    "articleText": "bounded extracted text",
    "headline": "Example headline",
    "publisher": "Example News"
  },
  "options": {
    "sourcePolicyId": "major-news-headline-v1",
    "captureWindowStart": 1773273600,
    "captureWindowEnd": 1773359999,
    "maxBundleBytes": 1048576,
    "networkClass": "public"
  },
  "context": {
    "fetchedAt": 1773311123,
    "artifactBaseDir": "./tmp"
  }
}
```

Notes:

- `capture` is the output of the preceding `newsfetch.capture` stage
- `capture` is bounded and normalized
- the worker may use the URL and policy to produce a real zkTLS-backed bundle
- the worker must not expand scope beyond the bounded request

### 7.3 Success Output Schema

The worker returns:

```json
{
  "schema_version": "openfox.cli-worker.v1",
  "worker": "zktls.bundle",
  "result": {
    "format": "zktls_bundle_v1",
    "bundleSha256": "0x...",
    "bundle": {
      "bundle_ref": "artifact://...",
      "source_url": "https://example.com/story",
      "canonical_url": "https://example.com/story",
      "captured_at": 1773311123,
      "source_policy_id": "major-news-headline-v1",
      "subject_sha256": "0x...",
      "origin_claims": {
        "domain": "example.com",
        "scheme": "https"
      },
      "verifier_material_refs": [
        "artifact://verifier-materials/zktls/example-v1.json"
      ],
      "normalized_result": {
        "headline": "Example headline",
        "publisher": "Example News"
      }
    }
  }
}
```

Required compatibility fields for the current OpenFox parser:

- `format`
- `bundleSha256`
- `bundle`

Everything else lives inside `bundle`.

### 7.4 Failure Output

For deterministic invalid or inconclusive cases, the worker should still emit a
JSON envelope to `stdout` and exit with `20` or `21`.

Example:

```json
{
  "schema_version": "openfox.cli-worker.v1",
  "worker": "zktls.bundle",
  "error": {
    "code": "source_policy_rejected",
    "message": "source did not satisfy bounded source policy"
  }
}
```

## 8. `proofverify.verify` Contract

### 8.1 Role

`proofverify.verify` is the real verifier stage behind `proof.verify`.

It should support clearly separated verifier classes:

- structural verification
- bundle integrity verification
- cryptographic proof verification

It must return a verdict that clearly states what class of verification was
actually performed.

### 8.2 Input Schema

Input:

```json
{
  "schema_version": "openfox.cli-worker.v1",
  "worker": "proofverify.verify",
  "request_id": "req_...",
  "request": {
    "capability": "proof.verify",
    "subject_url": "https://example.com/story",
    "subject_sha256": "0x...",
    "proof_bundle_url": "https://provider.example/news/fetch/bundle/job_123",
    "proof_bundle_sha256": "0x...",
    "request_nonce": "nonce_...",
    "request_expires_at": 1773273600
  },
  "options": {
    "verifierClass": "cryptographic_proof",
    "maxFetchBytes": 262144,
    "allowPrivateTargets": false
  },
  "context": {
    "verifierMaterialRefs": [
      "artifact://verifier-materials/zktls/example-v1.json"
    ]
  }
}
```

### 8.3 Success Output Schema

The worker returns:

```json
{
  "schema_version": "openfox.cli-worker.v1",
  "worker": "proofverify.verify",
  "result": {
    "verdict": "valid",
    "summary": "zkTLS bundle verified and subject hash matched",
    "metadata": {
      "verifier_class": "cryptographic_proof",
      "proof_class": "zktls_bundle_v1",
      "subject_sha256": "0x...",
      "bundle_sha256": "0x...",
      "checked_claims": [
        "origin.domain",
        "origin.scheme",
        "subject_sha256"
      ],
      "verifier_material_refs": [
        "artifact://verifier-materials/zktls/example-v1.json"
      ]
    },
    "verifierReceiptSha256": "0x..."
  }
}
```

Required compatibility fields for the current OpenFox parser:

- `verdict`
- `summary`
- `metadata`
- `verifierReceiptSha256`

### 8.4 Verdict Rules

Allowed verdicts:

- `valid`
- `invalid`
- `inconclusive`

Guidance:

- use `invalid` when the proof or integrity check deterministically fails
- use `inconclusive` when the request cannot be decisively verified within
  bounded policy
- always set `metadata.verifier_class`

## 9. Adapter Rules Inside OpenFox

The TypeScript adapter layer must:

- spawn the worker with a bounded timeout
- write one JSON request to `stdin`
- read one JSON response from `stdout`
- validate the envelope fields
- unwrap `result`
- pass the unwrapped object through the existing parser:
  - `parseZkTlsBundleSkillResult(...)`
  - `parseProofVerifySkillResult(...)`

It must also:

- capture `stderr` into operator-visible diagnostics
- map exit code categories into stable provider responses
- persist worker name, worker version, verifier refs, and bundle refs in local
  durable state
- keep the provider protocol unchanged for requesters

## 10. Durable Metadata Requirements

For `zktls.bundle`, OpenFox should persist:

- worker identifier and version
- source policy id
- origin claims
- verifier material refs
- bundle ref
- bundle hash
- subject hash

For `proofverify.verify`, OpenFox should persist:

- worker identifier and version
- verifier class
- proof class
- verdict reason code
- verifier material refs
- bound subject hash
- bound bundle hash
- receipt hash

## 11. Operator Visibility

Service status, `doctor`, and operator APIs should surface:

- backend mode: builtin, fallback, or real worker-backed
- selected worker command and backend contract version
- source policy coverage for `zktls.bundle`
- supported verifier classes for `proofverify.verify`
- last successful run
- last failure class
- degraded state caused by temporary worker failures

## 12. Deterministic Test Plan

Phase 42 tests should include:

- valid deterministic fixture path for `news.fetch -> zktls.bundle`
- replay/idempotency on identical nonce and request key
- source-policy rejection
- malformed worker stdout
- worker timeout

Phase 43 tests should include:

- valid proof bundle
- invalid proof bundle
- inconclusive verification path
- unsupported verifier class
- malformed verifier metadata

## 13. Non-Goals For v0

This document does not require:

- daemonized prover/verifier workers
- pooled worker scheduling
- GPU serving inside OpenFox
- proof generation for arbitrary LLM reasoning
- recursive proof aggregation

Those can be added later without changing the basic provider shell.

## 14. Immediate Build Target

The first real implementation should produce:

- one `zktls.bundle` CLI worker in Rust or Go
- one `proofverify.verify` CLI worker in Rust or Go
- one TypeScript adapter per worker inside OpenFox
- no public protocol changes for `news.fetch` or `proof.verify`

For `zktls.bundle`, the preferred first implementation is:

- Rust CLI worker
- directly using upstream TLSNotary `tlsn` crates where suitable
- no Node.js-native cryptographic prover path
- no requirement on `tlsn-js` or `tlsn-wasm`

This keeps OpenFox focused on protocol, payment, persistence, and operator
surface while moving the heavy cryptographic work into strong-language workers.
