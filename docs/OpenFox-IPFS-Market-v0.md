# OpenFox IPFS Market v0

## 1. Goal

OpenFox should support an agent-native storage market for artifacts, proofs, and result bundles without pushing large objects directly onto `TOS`.

The goal is:

`OpenFox agent -> paid storage providers -> immutable content bundle -> lightweight TOS anchor`

In one sentence:

**OpenFox IPFS Market v0 is an agent-native, paid, verifiable, TTL-based CAS storage market.**

## 2. Core Design

This market is based on four rules:

- **content-addressed**: stored content is identified by its content hash or `CID`
- **immutable**: stored content may expire, but it may never be modified in place
- **leased**: storage is sold as a time-bounded lease with a clear `TTL`
- **verifiable**: providers must return signed storage receipts and may be challenged later

This means:

- if the content changes, it becomes a new object with a new `CID`
- "updating" an artifact means storing a new bundle, not mutating the old one
- a provider may delete content after lease expiry
- a provider may not silently replace content under the same `CID`

## 3. Why This Exists

OpenFox already needs a place to store artifacts that are too large or too structured to fit cleanly into on-chain transaction data:

- oracle evidence bundles
- `zk-TLS` proofs
- committee vote bundles
- aggregate reports
- task outputs
- signed settlement artifacts

Putting all of this on `TOS` would make the chain heavy and awkward to query.

The cleaner split is:

- `TOS` stores small canonical anchors
- the IPFS market stores full bundles

## 4. Non-Goals for v0

OpenFox IPFS Market v0 does **not** attempt to be:

- a permanent archival network
- a Filecoin-scale economic protocol
- a generalized decentralized filesystem for arbitrary public internet traffic
- a chain-native storage VM
- a full proof-of-replication or proof-of-spacetime protocol

v0 is intentionally narrower:

- store agent artifacts
- price them
- lease them for a TTL
- retrieve them by `CID`
- optionally audit that providers still hold them

## 5. Actors

### 5.1 Client Agent

The client agent wants to store a bundle.

It is responsible for:

- constructing the bundle
- computing or confirming its `CID`
- selecting providers
- paying storage fees
- recording lease receipts
- optionally anchoring bundle metadata to `TOS`

### 5.2 Storage Provider Agent

The storage provider agent offers TTL-based storage.

It is responsible for:

- quoting storage terms
- accepting content
- pinning or otherwise holding the content for the agreed TTL
- serving retrieval by `CID`
- returning signed storage receipts
- responding to audits during the lease period

### 5.3 Verifier or Auditor Agent

The verifier or auditor agent checks whether a provider still holds data.

It is responsible for:

- issuing audit challenges
- verifying returned audit proofs
- reporting failures or success

### 5.4 Anchor Publisher

The anchor publisher writes a lightweight summary to `TOS`.

It may be:

- the client agent
- a sponsor
- an operator-controlled OpenFox instance

## 6. Storage Model

### 6.1 Content Addressing

Every stored artifact is represented by a `CID`.

The `CID` must be derived from the content itself, not from mutable metadata such as:

- filename
- URL
- provider identity
- upload time

### 6.2 Immutable Bundles

The market stores **bundles**, not mutable files.

A bundle is the canonical unit of storage for OpenFox artifacts.

Examples:

- a news evidence package
- a committee voting package
- a settlement proof package
- a task result package

If any byte of the bundle changes, the bundle becomes a new bundle with a new `CID`.

### 6.3 TTL Leases

Each storage agreement is a lease.

A lease must include:

- `cid`
- `provider_id`
- `issued_at`
- `expires_at`
- `ttl_seconds`
- `size_bytes`
- `price`

After expiry:

- the provider is no longer obligated to retain the content
- retrieval may legitimately fail

Before expiry:

- the provider must not mutate the content
- the provider should serve retrieval requests
- the provider should answer audit challenges

## 7. Bundle Format

v0 should standardize a simple bundle layout so every provider and client hashes the same artifact in the same way.

The recommended root object is a directory-like or archive-like bundle with a canonical manifest.

Minimum structure:

```text
bundle/
  manifest.json
  payload/
  proofs/
  metadata/
```

### 7.1 `manifest.json`

The manifest is mandatory.

It should include:

- `schema_version`
- `bundle_kind`
- `bundle_hash`
- `created_at`
- `created_by`
- `payload_entries`
- `proof_entries`
- `metadata_entries`

### 7.2 `payload/`

The primary artifact content.

Examples:

- `result.json`
- `capture.json`
- `aggregate-result.json`

### 7.3 `proofs/`

Optional proof material.

Examples:

- `zktls-proof.bin`
- `committee-signatures.json`
- `audit-proof.json`

### 7.4 `metadata/`

Optional additional metadata.

Examples:

- source descriptors
- task metadata
- human-readable summaries

## 8. Provider Capability Surface

Storage providers should expose a paid capability surface through Agent Discovery.

Recommended capabilities:

- `storage.quote`
- `storage.put`
- `storage.get`
- `storage.head`
- `storage.audit`
- `storage.renew`

These may be grouped under a common family such as:

- `storage.ipfs.quote`
- `storage.ipfs.put`
- `storage.ipfs.get`

v0 does not require one exact naming scheme, but the semantics should remain stable.

## 9. Core Objects

### 9.1 `StoreQuote`

Returned before payment and upload.

Minimum fields:

- `quote_id`
- `provider_id`
- `cid`
- `size_bytes`
- `ttl_seconds`
- `replica_policy`
- `price_wei`
- `payment_mode`
- `quote_expires_at`

### 9.2 `StorageLease`

Represents the accepted storage agreement.

Minimum fields:

- `lease_id`
- `provider_id`
- `cid`
- `size_bytes`
- `ttl_seconds`
- `issued_at`
- `expires_at`
- `price_wei`
- `payment_tx_hash`

### 9.3 `StorageReceipt`

Signed provider acknowledgment of a lease.

Minimum fields:

- `receipt_id`
- `lease_id`
- `provider_id`
- `cid`
- `issued_at`
- `expires_at`
- `receipt_hash`
- `provider_signature`

### 9.4 `AuditChallenge`

Used to test whether the provider still holds data.

Minimum fields:

- `challenge_id`
- `provider_id`
- `cid`
- `issued_at`
- `nonce`
- `selector`

### 9.5 `AuditProof`

Returned by the provider to answer an audit challenge.

Minimum fields:

- `challenge_id`
- `provider_id`
- `cid`
- `proof_kind`
- `proof_payload`
- `responded_at`
- `provider_signature`

### 9.6 `AnchorRecord`

The small canonical summary published to `TOS`.

Minimum fields:

- `anchor_id`
- `cid`
- `bundle_kind`
- `bundle_hash`
- `lease_root`
- `replica_count`
- `earliest_expiry`
- `published_at`
- `publisher_address`

## 10. Lifecycle

### 10.1 Prepare Bundle

The client agent:

- builds the bundle
- canonicalizes the bundle
- computes its `CID`

### 10.2 Request Quotes

The client asks one or more storage providers for quotes.

The provider returns:

- supported `TTL`
- maximum size
- price
- optional audit policy

### 10.3 Pay and Store

The client pays the provider and submits the bundle.

The provider:

- verifies payment
- stores the content
- returns a signed `StorageReceipt`

### 10.4 Replicate

The client may store the same `CID` with multiple providers.

This is strongly recommended for:

- important oracle bundles
- settlement artifacts
- public result archives

### 10.5 Anchor to TOS

The client or publisher may write a lightweight `AnchorRecord` to `TOS`.

Only a small canonical summary should be anchored.

### 10.6 Retrieve

Anyone with the `CID` may retrieve the bundle from:

- one provider directly
- a gateway
- another compatible node that holds the same content

### 10.7 Audit

Before expiry, auditors may challenge providers to prove they still hold the bundle.

### 10.8 Renew or Expire

Before expiry, the client may renew the lease.

If no renewal occurs:

- the lease expires
- the content may be deleted

## 11. Immutability Rule

This rule is mandatory:

**a stored object may expire, but it may never be modified in place**

That means:

- no overwrite under the same `CID`
- no mutable latest-pointer hidden inside provider state
- no provider-side content substitution

If an operator wants a "new version" of a result:

- create a new bundle
- derive a new `CID`
- optionally anchor the new `CID`

## 12. Retrieval Semantics

Retrieval in v0 is simple.

The market should support:

- `head(cid)` to confirm metadata or availability
- `get(cid)` to fetch the bundle

The client should be able to distinguish:

- `present`
- `expired`
- `not found`
- `provider unavailable`

This distinction matters because expiry is a valid state, while silent loss during an active lease is a failure.

## 13. Verification and Audit

v0 should support lightweight verification, not heavyweight cryptoeconomic proofs.

The minimum verification model is:

- the provider signs a `StorageReceipt`
- the provider can be challenged during the TTL
- the provider must return a proof of possession or chunk-based response

Recommended v0 audit forms:

- hash challenge over selected bundle segments
- Merkle-chunk proof if the bundle is chunked
- signed retrieval proof tied to a challenge nonce

Audit failure means:

- the provider did not answer
- or the proof does not validate

v0 may record failures off-chain first.
Later versions may tie audit failures to market reputation or slashing-like mechanisms.

## 14. Payment Model

The payment model should remain native to OpenFox and `TOS`.

Recommended v0 payment path:

- provider publishes quote
- client pays through `x402` or direct `TOS`
- provider confirms payment
- provider issues `StorageReceipt`

Pricing may depend on:

- `size_bytes`
- `ttl_seconds`
- optional replication count
- retrieval bandwidth policy
- audit overhead

## 15. Discovery Model

Storage providers should publish themselves through Agent Discovery.

Their discovery card should include:

- capability names
- pricing model
- max size
- supported TTL ranges
- retrieval endpoint
- audit support

This allows OpenFox operators to discover storage providers the same way they discover oracle or observation providers.

## 16. TOS Anchor Model

`TOS` should remain lightweight.

The chain should store only canonical summaries such as:

- `cid`
- `bundle_hash`
- `lease_root`
- `replica_count`
- `earliest_expiry`
- `publisher_address`

The chain should **not** be used as the primary blob store for:

- bundle payloads
- large proofs
- raw evidence archives

This keeps `TOS` clean while preserving a durable integrity anchor.

## 17. Trust and Failure Model

v0 provides stronger guarantees than a plain URL, but weaker guarantees than a fully cryptoeconomic storage protocol.

What v0 does provide:

- immutable content identity
- provider receipts
- paid storage leases
- optional replication
- optional audit
- lightweight on-chain anchoring

What v0 does not fully provide:

- permanent availability
- trustless proof-of-replication
- automatic slashing
- universal public pinning

Therefore, important content should use:

- multiple providers
- periodic audits
- renewal before expiry

## 18. Recommended First Use Cases

OpenFox IPFS Market v0 is especially well suited for:

- oracle evidence bundles
- public news capture artifacts
- `zk-TLS` result packages
- committee vote archives
- settlement result bundles
- bounty output bundles

## 19. Operator Guidance

The recommended operator pattern is:

- run one OpenFox client agent
- discover multiple storage providers
- store important bundles with more than one provider
- anchor only lightweight summaries to `TOS`

For high-value bundles, operators should prefer:

- at least two providers
- at least one audit during the lease
- explicit renewal policy

## 20. Future Extensions

Future versions may add:

- provider reputation scoring
- automated audit scheduling
- repair and re-replication
- stronger chunk proof schemes
- contract-native storage leases
- chain-queryable storage lease registries

## 21. Summary

OpenFox IPFS Market v0 defines a simple rule set:

- agents can buy storage from other agents
- stored artifacts are content-addressed
- stored artifacts are immutable
- storage expires by lease
- retrieval is by `CID`
- large data stays off-chain
- `TOS` stores only the lightweight anchor

This is the right first storage model for OpenFox:

**agent-native, paid, verifiable, TTL-based, and cleanly separated from the chain itself.**
