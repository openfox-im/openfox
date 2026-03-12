# OpenFox TrueNews Verified News Market v0

## Status

Draft.

## 1. Summary

This document describes a **third-party product pattern** that can be built on
top of OpenFox:

> a verified news market where one agent publishes a bounded news-capture task,
> other agents verify the result, and the final verified item is published as a
> durable artifact feed.

OpenFox itself is **not** required to become a news publisher or media brand.
The intended role of OpenFox is to provide the reusable infrastructure:

- provider shells
- skill-composed backends
- discovery and gateway
- task and bounty flows
- artifact storage
- settlement and payouts
- committee coordination
- proof and verification surfaces

In other words:

**TrueNews is an application built on OpenFox, not a synonym for OpenFox.**

## 2. Product Goal

The target product is a bounded and auditable news flow that approaches:

- `zkTLS` for source-origin evidence
- `M-of-N` verifier committees
- optional succinct proofs over normalization and threshold aggregation

The target slogan is:

**SNARK over M-of-N small LLMs over zkTLS bundles from major news sites**

However, the practical implementation must stay more precise:

- `zkTLS` proves the source session or source bytes
- small LLMs perform bounded interpretation and structured voting
- `SNARK` proves constrained normalization and threshold aggregation, not the
  full unconstrained reasoning chain of a general-purpose LLM

## 3. OpenFox's Role

OpenFox should provide the infrastructure needed for this product family.

It should not require runtime rewrites for each new verified-media product.

The reusable OpenFox surfaces are:

- `news.fetch`
- `proof.verify`
- `storage.put`
- `storage.get`
- evidence workflow coordination
- task marketplace and bounty payouts
- agent discovery and gateway routing
- artifact publication and anchoring

These surfaces may be implemented through:

- built-in protocol shells
- skill-composed backends
- reusable coordinator and operator templates

## 4. Design Goal

Allow a third-party operator to launch a verified-news market where:

1. a publisher agent creates a bounded news-capture task
2. a capturer agent submits a source-backed result bundle
3. a verifier committee of `N` agents independently reviews the bundle
4. at least `M` valid verifier signatures are collected
5. the final result is aggregated, stored, and published
6. downstream consumers subscribe through `news.get`

## 5. Non-Goals

This design does not assume:

- that OpenFox itself is the media outlet
- that OpenFox proves the full internal reasoning of a general LLM
- that v0 resolves all decentralized oracle disputes
- that every news workflow requires on-chain final settlement
- that all proofs must be generated on day one

## 6. High-Level Two-Task Model

The recommended market structure is two linked tasks.

### 6.1 Task A: Capture Task

The publisher agent issues a bounded task such as:

> Capture the homepage headline from a specific major news source on a specific
> date, and submit a result bundle with source-origin evidence.

This task should require:

- a bounded source policy
- a bounded selector or extraction policy
- a durable bundle artifact
- a structured normalized result

### 6.2 Task B: Verification Committee Task

After a capture bundle exists, the publisher agent issues a second task:

> Verify this capture bundle. Collect at least `M` valid signed votes from a
> committee of size `N`.

This second task should:

- pay verifier agents
- enforce bounded structured votes
- track diversity and anti-collusion policy
- produce one canonical aggregate

## 7. Core Objects

### 7.1 News Query

```json
{
  "query_id": "newsq_...",
  "source": "example-news-site",
  "source_policy_id": "homepage-headline-v1",
  "date": "2026-03-12",
  "selector_policy": "homepage_main_headline",
  "capture_window_start": 1773273600,
  "capture_window_end": 1773359999,
  "result_schema": "headline_text_v1",
  "required_proofs": ["zktls", "bundle_hash"],
  "committee_size": 7,
  "threshold_m": 5
}
```

This object defines the bounded job:

- what source is allowed
- when it may be captured
- how the result must be shaped
- what proof classes are required
- what committee threshold applies

### 7.2 Capture Bundle

```json
{
  "capture_id": "cap_...",
  "query_id": "newsq_...",
  "capturer_agent_id": "agent_...",
  "source_url": "https://example.com/news",
  "captured_at": 1773311123,
  "zktls_bundle_ref": "artifact://...",
  "source_bytes_hash": "0x...",
  "normalized_result": {
    "headline": "..."
  },
  "normalization_policy_hash": "0x...",
  "capture_signature": "0x..."
}
```

This should be stored as a durable artifact-backed object.

### 7.3 Verifier Vote

```json
{
  "vote_id": "vote_...",
  "query_id": "newsq_...",
  "capture_id": "cap_...",
  "verifier_agent_id": "agent_...",
  "verifier_model_profile": "qwen2.5-14b",
  "verifier_env_profile": {
    "region": "eu-west",
    "network_class": "residential",
    "asn": 12345
  },
  "decision": "accept",
  "reason_code": "headline_matches_policy",
  "result_hash": "0x...",
  "signature": "0x..."
}
```

The verifier output should stay strongly structured.

V0 should avoid long free-form reasoning as the canonical vote object.

### 7.4 Threshold Aggregate

```json
{
  "aggregate_id": "agg_...",
  "query_id": "newsq_...",
  "capture_id": "cap_...",
  "committee_size": 7,
  "threshold_m": 5,
  "accepted_votes": 5,
  "rejected_votes": 1,
  "inconclusive_votes": 1,
  "winning_result_hash": "0x...",
  "vote_root": "0x...",
  "aggregate_proof_ref": "artifact://...",
  "final_status": "verified"
}
```

### 7.5 Final News Entry

```json
{
  "news_id": "news_...",
  "source": "example-news-site",
  "date": "2026-03-12",
  "headline": "...",
  "verification_status": "verified_m_of_n",
  "capture_artifact_id": "artifact://...",
  "aggregate_artifact_id": "artifact://...",
  "published_at": 1773312200
}
```

This object is what downstream consumers should retrieve through `news.get`.

## 8. Capability Surfaces

The OpenFox substrate for this product should be composed from these capability
families.

### 8.1 Capture and Evidence

- `news.fetch`
- `storage.put`
- `storage.get`
- `oracle.evidence`

### 8.2 Verification

- `proof.verify`
- `news.vote`

### 8.3 Aggregation and Publication

- `news.aggregate`
- `news.get`
- `news.latest`

### 8.4 Supporting Infrastructure

- `gateway.relay`
- task marketplace and payout surfaces
- artifact storage and anchoring

## 9. Skill-Composed Backend Shape

This market should be built using OpenFox's stable provider shells plus
skill-composed backends.

Recommended stage chains:

- `news.fetch`
  - `newsfetch.capture`
  - `zktls.bundle`
- `proof.verify`
  - `proofverify.verify`
- `news.vote`
  - `llm.extract`
  - `headline.vote`
- `news.aggregate`
  - `committee.tally`
  - `committee.aggregate`
  - optional `snark.prove`
- `news.get`
  - `artifact.render`
  - `feed.publish`

The provider shell should remain responsible for:

- HTTP shape
- payment and anti-replay
- persistence
- backend selection
- operator-visible health

The changing workflow logic should remain behind versioned backend contracts.

## 10. What zkTLS Should Prove

The realistic v0 claim is:

- the submitted source evidence came from the bounded source-origin path
- the captured bytes or transcript are committed by hash
- the normalized result is tied to that captured material

This is much stronger than a normal HTTP scrape, but it is not the same thing
as proving the ultimate truth of a news statement.

## 11. What the Committee Should Prove

The verifier committee should prove:

- enough verifiers reviewed the same capture bundle
- the votes meet the threshold `M`
- the accepted result hash is canonical for the aggregate
- the committee outcome can be replayed and audited from durable records

It should also enforce bounded diversity rules.

## 12. Diversity and Anti-Collusion Policy

For committee workflows, the coordinator should not accept merely `M`
signatures. It should accept `M` signatures that satisfy diversity policy.

Examples:

- minimum number of distinct model families
- minimum number of distinct regions
- minimum number of distinct ASNs
- no double-counting the same operator identity

These are weak-to-moderate anti-collusion signals, not cryptographic identity
proofs. They still improve the committee quality significantly.

## 13. What SNARK Should Prove

The realistic SNARK target is not:

- arbitrary LLM reasoning over arbitrary text

The realistic SNARK target is:

- constrained normalization integrity
- canonical vote-root binding
- threshold tally correctness
- binding between aggregate result and stored inputs

So the practical path is:

- `zkTLS` proves source-origin evidence
- small LLMs produce bounded structured votes
- `SNARK` proves normalization and threshold aggregation integrity

## 14. Storage and Publication

All durable intermediate and final objects should be stored through the
existing OpenFox storage and artifact pipeline.

Suggested artifact families:

- capture bundle
- verifier vote bundle
- committee aggregate bundle
- final news entry bundle
- optional verifier-material bundle

Downstream consumers should subscribe through a read surface such as:

- `news.get`
- `news.latest`
- `news.by_source`
- `news.by_day`

## 15. Roles in the Market

The system should support the following roles:

- publisher / coordinator
- capturer
- verifier
- aggregator
- storage provider
- feed consumer

OpenFox provides the substrate for each role, but the market operator chooses
which product roles to expose.

## 16. What Exists Today

The current OpenFox base already includes:

- `news.fetch` provider shell
- `proof.verify` provider shell
- evidence workflow coordination skeleton
- `M-of-N` workflow skeleton
- artifact and storage pipeline
- payment, settlement, discovery, and gateway infrastructure

That means this product family is **not starting from zero**.

## 17. What Still Needs Stronger Infrastructure

To reach the stronger "verifiable AI consensus" end state, the following must
still be implemented more fully:

- a real zkTLS backend behind `news.fetch`
- a real proof-verifier backend behind `proof.verify`
- stronger coordinator-side `M-of-N` assignment, tallying, and payout logic
- more complete public proof and verification infrastructure

These correspond directly to the future OpenFox roadmap phases:

- stronger zkTLS backend integration
- stronger proof verifier backend integration
- coordinator-side `M-of-N` evidence and oracle committees
- public proof and verification infrastructure

## 18. Product Boundary

This document is intentionally framed as a **product on top of OpenFox**, not a
redefinition of OpenFox itself.

OpenFox should ship:

- the substrate
- the backend interfaces
- the marketplace and payment plumbing
- the storage and artifact pipeline
- the discovery and gateway substrate

TrueNews-style products can then be launched by:

- OpenFox Labs
- third-party operators
- domain-specific media or verification agents

## 19. One-Sentence End State

If this design is implemented well, OpenFox will make it possible for a
third-party operator to launch:

**a verifiable news market where bounded source bundles are captured with
zkTLS-backed evidence, reviewed by an M-of-N verifier committee, aggregated
into durable artifacts, and served to downstream subscribers through reusable
OpenFox infrastructure**
