# OpenFox Integration Roadmap

## 1. Goal

The goal is not merely to make `openfox` "support another chain." The goal is to make an `openfox` agent/operator able to:

- hold and use a `TOS` wallet
- sign and send transactions on the `TOS` network
- pay for real services through `x402`
- take jobs, perform oracle and observation work, and earn revenue on `TOS`

In one sentence:

`openfox` should become a payable, executable, revenue-generating agent runtime on `TOS`.

## 2. What Is Already Done ✅

### 2.1 On the OpenFox Side ✅

- `TOS` address derivation and local wallet integration are implemented
- native `TOS` transfer signing and submission are implemented
- `tos-status` and `tos-send` CLI commands are implemented
- the `x402` client recognizes `tos:<chainId>` and can construct TOS payments
- when a service offers both USDC and TOS payment requirements, OpenFox prefers TOS
- Agent Discovery requester/provider flows are implemented
- Agent Gateway relay flows are implemented

### 2.2 On the TOS/GTOS Side ✅

- `x402` header encoding and decoding are implemented
- native `TOS` transaction envelope parsing and verification are implemented
- `x402` HTTP middleware is implemented
- the minimal demo service `cmd/x402demo` is implemented
- real `TOS x402` end-to-end testing on a local three-node network has been completed
- the RPC signer inference bug has been fixed so validator-related flows do not incorrectly fall back to `secp256k1`
- Agent Discovery and Agent Gateway v1 are implemented

### 2.3 Current Conclusion ✅

The minimum end-to-end path is already working:

`openfox wallet -> TOS native tx signing -> x402 payment -> gtos/x402 verification -> paid endpoint`

And a broader agent-to-agent base is also now working:

`OpenFox wallet -> Agent Discovery -> Agent Gateway -> provider invocation -> TOS payment/reward path`

However, this is still "integrated and testable," not yet "production-ready and scalable."

## 3. Overall Roadmap

The recommended path is staged.

### Phase 0: Core Path Working ✅

Status: completed

Goals:

- wallet creation works
- address derivation works
- native transfer submission works
- the minimum `x402` payment path works

Deliverables:

- the `TOS` SDK in `openfox`
- `gtos/x402`
- `x402demo`

### Phase 0.5: Testnet Agent-to-Agent Bounty MVP

Status: completed

Goal:

- prove the first real OpenFox economy loop on testnet before introducing full oracle complexity

This phase should intentionally stay simple.

We run one OpenFox instance as a **Bounty Host Agent**. A user runs another OpenFox instance as a **Solver Agent**. The host agent asks a prediction-style question, the solver submits an answer, and the winning solver receives `TOS` after manual judging.

This phase does **not** require:

- decentralized oracle resolution
- dispute games
- zk proofs
- on-chain truth settlement

For this MVP, judgment is explicitly manual:

- we create the question
- we decide the answer offline
- we may use off-chain AI to help judge
- the payout is then executed by the host OpenFox agent

Suggested capability surface:

- `bounty.prediction.info`
- `bounty.prediction.submit`
- `bounty.prediction.result`
- optional `gateway.relay`
- optional `sponsor.topup.testnet`

Required work:

- implement one bounty host flow in `openfox`
- implement one solver flow in `openfox`
- define a minimal bounty schema:
  - `bounty_id`
  - `question`
  - `question_type`
  - `reward_wei`
  - `submission_deadline`
  - `judge_mode = manual`
- define a minimal submission schema:
  - `submission_id`
  - `bounty_id`
  - `solver_agent_id`
  - `solver_tos_address`
  - `answer_payload`
  - `submitted_at`
- define a minimal result schema:
  - `bounty_id`
  - `status`
  - `winning_submission_id`
  - `judge_note`
  - `payout_tx_hash`
- make the host agent discoverable through Agent Discovery
- optionally make the host reachable through an Agent Gateway if it is not on a public IP
- pay the winning solver in testnet `TOS`

Acceptance criteria:

- at least one bounty host agent is running
- at least one solver agent can discover it
- a real submission can be made before deadline
- the result can be published later
- a real testnet `TOS` payout can be sent to the winning solver

Why this phase matters:

- it proves that users can run OpenFox and connect to testnet
- it proves that one agent can find another agent to solve a problem
- it proves that useful work can end in a `TOS` reward
- it gives us a credible "agent-to-agent economy" prototype without needing a full oracle design

Delivered surface:

- generic task marketplace engine in `openfox`
- automated host / solver flows
- local model judging
- native `TOS` payout hooks
- local multi-role operator wrappers and guides
- discovery-aware host/solver/scout paths

### Phase 1: Wallet and Onboarding Productization

Status: completed

Goal:

- a new operator should be able to obtain a usable `TOS` wallet and perform first on-chain actions within minutes

Required work:

- officially integrate `TOS` setup into the `openfox` setup flow
- add one-click funding for local devnet and testnet
- clearly define the boundary between `secp256k1` wallets and other signer types
- provide a complete signer metadata bootstrap flow for non-`secp256k1` accounts
- improve errors for missing `TOS_RPC_URL`, insufficient balance, nonce conflicts, and related issues

Acceptance criteria:

- a fresh machine can complete `install -> create wallet -> check balance -> receive funds -> send transaction`
- no manual source reading or handcrafted RPC requests are required

Delivered surface:

- `openfox onboard --fund-local`
- `openfox onboard --fund-testnet`
- `openfox wallet status`
- `openfox wallet fund local`
- `openfox wallet fund testnet`
- `openfox wallet bootstrap-signer --type <ed25519|secp256r1|bls12-381|elgamal>`
- improved native wallet error guidance for RPC, balance, nonce, and signer metadata issues

Important boundary:

- non-`secp256k1` signer bootstrap only works when the configured wallet address already matches the signer-derived native address
- OpenFox local runtime transaction flows remain optimized for the built-in local `secp256k1` wallet path

### Phase 2: Launch Real Paid Services

Status: completed

Goal:

- move beyond demo endpoints and offer paid services with real value output

The initial scope should stay narrow and start with only two categories.

#### A. Paid Oracle Resolution API

Suggested endpoints:

- `POST /oracle/quote`
- `POST /oracle/resolve`
- `GET /oracle/result/:id`

Service output:

- event market resolution
- scalar market value resolution
- evidence summary
- canonical result output

#### B. Paid Observation API

Suggested endpoints:

- `POST /observe`
- `GET /jobs/:id`

Service output:

- one-shot observation
- windowed observation
- standardized observation receipt

Required work in this phase:

- connect `x402` middleware to real business handlers
- introduce payment idempotency
- bind payment to the underlying resource or request
- define a minimum pricing model
- define a standard result structure

Acceptance criteria:

- the user pays once in `TOS`
- the user receives a real business result instead of a test JSON payload

Delivered surface so far:

- a real paid observation provider built into OpenFox
- `POST /observe` for paid one-shot observations
- `GET /jobs/:id` for persisted observation result lookup
- payment-bound observation receipts with `job_id`, `result_url`, and `payment_tx_hash`
- duplicate request replay handled idempotently without charging twice
- a real paid oracle-style resolver built into OpenFox
- `POST /oracle/quote` for request/pricing discovery
- `POST /oracle/resolve` for paid bounded local-model resolution
- `GET /oracle/result/:id` for persisted result lookup
- payment-bound oracle receipts with `result_id`, `result_url`, and `payment_tx_hash`

### Phase 3: On-Chain Task and Settlement Integration

Status: completed

Goal:

- turn paid services from purely off-chain APIs into services integrated with the `TOS` contract and task system

Suggested scope:

- contract-based task and oracle market
- binding between query/job IDs and on-chain state
- standard result hash, receipt, and settlement interfaces
- scheduler integration

Suggested first targets:

- observation job contract
- oracle result contract
- result hash and receipt helper

Not recommended at this stage:

- a fully general agent execution market
- complex dispute trees
- heavy proof-verifier economics

Acceptance criteria:

- a query or job can complete a full lifecycle: creation, payment, execution, callback, and settlement

Delivered surface so far:

- canonical settlement receipt and result-hash helpers in `tosdk`
- persisted settlement receipt storage in OpenFox
- native on-chain settlement anchors for:
  - bounty results
  - paid observation jobs
  - paid oracle results
- idempotent settlement publication per `(kind, subject_id)`
- `openfox settlement list|get`
- `openfox settlement callbacks`
- settlement visibility in `openfox status`, `openfox health`, and `openfox doctor`
- contract callback adapters for bounty, observation, and oracle receipts
- scheduler-driven settlement callback confirmation and retry through heartbeat
- canonical market binding and binding-hash helpers in `tosdk`
- package-call encoding helpers for contract-native callback delivery
- persisted market binding storage in OpenFox
- contract-native market bindings for:
  - bounty creation
  - paid observation requests
  - paid oracle requests
- idempotent market binding publication per `(kind, subject_id)`
- `openfox market list|get|callbacks`
- market binding visibility in `openfox status`, `openfox health`, and `openfox doctor`
- scheduler-driven market callback confirmation and retry through heartbeat

### Phase 4: Productionize the x402 Server Side

Status: completed

Goal:

- turn the current "works in practice" `x402` path into a reliable long-term public payment entrypoint

Required work:

- receipt and confirmation policy
- duplicate payment detection
- replay protection
- nonce conflict and replacement handling
- recovery semantics after broadcast failure
- server-side payment ledger
- auditable binding between payment and business result

Acceptance criteria:

- the server handles duplicate requests, broadcast failures, timeouts, and retries correctly
- the same payment envelope cannot be replayed to unlock the same service repeatedly

Delivered surface:

- durable server-side x402 payment ledger in OpenFox
- auditable request hashing and payment-to-result binding
- duplicate payment detection and replay protection
- nonce replacement handling for same-request payment retries
- receipt-aware confirmation policy for paid services
- recovery semantics after broadcast failure and retryable payment replay
- `openfox payments list|get|retry`
- heartbeat-driven x402 payment retries
- x402 payment visibility in `openfox status`, `openfox health`, and `openfox doctor`

### Phase 5: Ecosystem and SDK Productization

Status: completed

Goal:

- let third-party agents and operators integrate independently, without manual assistance

Suggested work items:

- extract `tos-agent-kit` into an independent package
- prepare a minimum quickstart
- prepare `web4.ai`, MCP, and API service integration examples
- provide a local development template
- provide task sponsor and service operator examples

Acceptance criteria:

- a third-party developer can complete integration without needing to study internal implementation details

Delivered surface:

- external `tosdk` package as the native network SDK layer
- bundled `openfox templates` catalog with exportable starter stacks
- third-party quickstart for `setup -> fund -> discover -> pay -> receive result`
- web4.ai, MCP, and API service integration examples
- local marketplace, public provider, and task sponsor example packs
- explicit SDK/runtime surface guidance for `tosdk` vs OpenFox

### Phase 6: OpenFox IPFS Market v0

Status: completed

Goal:

- add an agent-native storage market for artifacts, proofs, and result bundles without pushing large objects directly onto `TOS`

This phase introduces a new storage layer for OpenFox:

- providers offer paid, TTL-based storage
- clients store immutable bundles by `CID`
- retrieval happens by `CID`
- `TOS` stores only lightweight anchors and lease summaries

This is not a general-purpose storage chain.
It is a practical storage market for OpenFox artifacts.

Design constraints:

- content-addressed bundles
- immutable content
- storage leases with explicit `TTL`
- signed storage receipts
- optional audits during the lease window
- lightweight `TOS` anchors instead of full on-chain blobs

Suggested capability surface:

- `storage.quote`
- `storage.put`
- `storage.get`
- `storage.head`
- `storage.audit`
- `storage.renew`

Required work:

- define the canonical bundle manifest format
- add an OpenFox storage client for `CID`-addressed bundles
- add a storage-provider service mode with paid quote/put/get flows
- add lease, receipt, and audit record storage in the OpenFox database
- bind storage payments to issued storage receipts
- define lightweight `TOS` storage anchors for `cid`, `bundle_hash`, `lease_root`, and expiry summaries
- publish storage providers through Agent Discovery and optional Agent Gateway
- add operator-facing status, health, and doctor visibility for stored artifacts and lease health

Acceptance criteria:

- one OpenFox agent can store a bundle with one or more storage-provider agents
- the provider returns a signed receipt for the active lease
- the same `CID` can be retrieved before expiry
- the provider cannot modify content in place under the same `CID`
- a lightweight summary of the storage result can be anchored to `TOS`

Delivered surface target:

- `OpenFox-IPFS-Market-v0.md`
- paid storage provider mode inside OpenFox
- canonical bundle manifest and `CID` handling
- persisted lease and receipt tracking
- retrieval, audit, renewal, and replication endpoints
- lightweight `TOS` anchor support for stored bundles
- `openfox storage list|quote|put|renew|replicate|head|get|audit`
- scheduler-driven lease audit, renewal, and replication upkeep
- storage lease, renewal, audit, replication, and anchor visibility in `status`, `health`, and `doctor`

### Phase 7: Verifiable Public News and Oracle Bundles

Status: completed

Goal:

- build a verifiable public-artifact pipeline on top of the storage market, starting with public news capture and oracle evidence

This phase should use the storage market as the artifact layer for:

- public news capture bundles
- `zk-TLS` evidence bundles
- verifier receipts
- committee vote bundles
- aggregate oracle reports

The intended workflow is:

`public bounty -> capture evidence -> verify evidence -> committee resolution -> store immutable bundle -> anchor lightweight summary to TOS`

Required work:

- define canonical bundle kinds for news evidence and oracle aggregation
- add sponsor and bounty flows for public evidence capture
- add verifier flows for evidence checking
- add committee-result packaging for `M-of-N` agent voting
- bind final result summaries to `TOS` anchors while storing full artifacts in the IPFS market

Acceptance criteria:

- a public news or oracle artifact can be captured, bundled, stored, and later retrieved by `CID`
- the final result summary is anchored on `TOS`
- the chain remains lightweight while the full evidence stays available through the storage market

Delivered surface:

- canonical artifact verification and anchor hashing helpers in `tosdk`
- persisted artifact, verification, and anchor records in OpenFox
- `openfox artifacts list|get|capture-news|oracle-evidence|oracle-aggregate|committee-vote|verify|anchor`
- sponsored public artifact capture service inside OpenFox
- storage-backed public news capture bundles
- storage-backed oracle evidence, committee vote, and aggregate bundles
- local verification receipts with persistent verification records
- lightweight native artifact anchors with persistent anchor records
- artifact search and indexing across source URL, subject, query, anchored, and verified filters
- explicit multi-node deployment guidance for requester/provider/gateway/storage/artifact roles
- artifact visibility in `openfox status`, `openfox health`, and `openfox doctor`

### Phase 8: Programmable Wallet and Signer-Provider v0

Status: completed

Goal:

- turn `tolang` programmable wallets and `gtos` delegation/account-abstraction primitives into a discoverable OpenFox service for bounded delegated execution

This phase is not a detached wallet feature.
It is the execution-control layer for the systems already shipped in earlier phases:

- bounty payouts
- oracle and observation settlement callbacks
- storage renewal and audit operations
- artifact anchoring and maintenance

Suggested capability surface:

- `signer.quote`
- `signer.submit`
- `signer.status`
- `signer.receipt`

Required work:

- define the signer-provider request, quote, and receipt schema
- add a signer-provider service mode to OpenFox
- integrate signer-provider publication into Agent Discovery and optional Agent Gateway
- bind signer-provider payments to execution receipts via `x402`
- add a remote delegated-execution client path beside the local wallet path
- persist signer-provider quotes, requests, and receipts in the OpenFox database
- expose signer-provider visibility in `status`, `health`, and `doctor`
- document the funding boundary clearly: `v0` assumes the programmable wallet already holds enough `TOS` or uses a separate funding flow

Acceptance criteria:

- one OpenFox node can publish signer-provider capability
- another node can discover it, pay it, and request bounded delegated execution
- the delegated wallet call is accepted or rejected by the programmable wallet's `validate()` rules
- the provider cannot exceed the delegated policy boundary
- OpenFox persists an auditable execution receipt for each request

Design reference:

- `OpenFox-Signer-Provider-v0.md`
- `OpenFox-Signer-Provider-Operator-Guide.md`

Delivered surface:

- canonical signer-provider quote, submit, status, and receipt objects
- signer-provider policy hashing and bounded execution validation
- signer-provider HTTP service mode inside OpenFox
- persistent signer quote and execution records in the OpenFox database
- `x402` payment binding for paid signer submission flows
- requester-side `openfox signer discover|quote|submit|status|receipt`
- discovery publication for signer capabilities and optional gateway relay publication
- `trust_tier` selection and requester-side warnings for overly permissive providers
- signer-provider visibility in `openfox status`, `openfox health`, `openfox doctor`, and service operator UX
- operator guidance for principal, requester, and signer-provider roles

### Phase 9: Native Sponsored Execution and Paymaster-Provider v0

Status: completed

Goal:

- add native sponsor-aware transaction support to `TOS/GTOS`, then expose it through OpenFox as a paymaster-provider capability

This phase should not be treated as an afterthought or a faucet variant.
It is the funding-control layer that completes the programmable execution stack introduced in Phase 8.

Signer-provider and paymaster-provider solve different problems:

- signer-provider decides who may execute
- paymaster-provider decides who may pay for execution

Suggested capability surface:

- `paymaster.quote`
- `paymaster.authorize`
- `paymaster.status`
- `paymaster.receipt`

Required work:

- add unified sponsor-aware native transaction semantics in `gtos`
- add sponsor identity, sponsor witness, and sponsor policy binding to the transaction model
- keep unified sponsor-aware native transactions aligned with ordinary native execution so sponsored execution supports the same `SignerType` matrix on both execution and sponsor sides
- change mempool and state-transition rules so sponsor-side balance and sponsor-side authorization can replace requester-side gas funding
- add first-class sponsor validation hooks in `gtos` and `tolang`
- add an OpenFox paymaster-provider service mode and client path
- support composition across:
  - local wallet + paymaster-provider
  - signer-provider + paymaster-provider
  - combined signer-provider + paymaster-provider
- persist sponsorship quotes, authorizations, and receipts in OpenFox
- expose sponsored execution visibility in `status`, `health`, and `doctor`
- optimize for a clean protocol design now, not for backward compatibility or migration workarounds

Acceptance criteria:

- a wallet with insufficient own `TOS` can execute through valid sponsor authorization
- validation and execution costs are charged to the sponsor side
- sponsorship is rejected outside sponsor policy boundaries
- unified sponsor-aware native transactions support the same `SignerType` set for both execution-side and sponsor-side authorization
- sponsored execution composes with signer-provider flows
- OpenFox persists auditable sponsorship receipts

Design reference:

- `OpenFox-Paymaster-Provider-v0.md`

Delivered surface:

- canonical `paymaster.quote`, `paymaster.authorize`, `paymaster.status`, and `paymaster.receipt` objects
- sponsor-policy hashing and bounded sponsorship validation inside OpenFox
- native sponsored execution helpers across `gtos` and `tosdk`, including sponsor nonce access and sponsored envelope handling
- a built-in paymaster-provider HTTP service inside OpenFox
- `openfox paymaster discover|quote|authorize|status|receipt`
- discovery publication and optional gateway relay publication for paymaster-provider routes
- paymaster-provider visibility in `openfox status`, `openfox health`, `openfox doctor`, and service operator UX
- operator guidance for requester, sponsor principal, and paymaster-provider roles

## 4. Near-Term Priorities

Suggested priority order:

### P0: Do Immediately

- completed:
  - hardened multi-node deployment guidance for client/provider/gateway/storage-provider roles
  - broadened artifact verification and indexing around anchored public bundles
  - added sponsor and bounty flows for public evidence capture

### P1: Do Next

- completed:
  - added authenticated remote maintenance for storage and artifact nodes
  - added `openfox storage maintain` and `openfox artifacts maintain`
  - added `openfox fleet repair <storage|artifacts>` for batch fleet remediation

### P2: Do Later

- completed:
  - added provider reputation reporting across storage, artifacts, signer, and paymaster operators
  - added storage lease-health reporting across CLI, operator API, fleet audits, status, and doctor
  - extracted reusable `tosdk` storage and artifact provider client surfaces for third-party builders
  - linked signer and paymaster receipts back into storage lease, artifact verification, and anchoring trails

## 5. What Not to Do Yet

- do not start with a general agent execution marketplace
- do not start with a complex oracle dispute system
- do not start with a full `zkTLS + SNARK` proof pipeline
- do not push large artifacts and proof bundles directly onto `TOS`
- do not push all application logic into native chain modules
- do not try to build a Filecoin-scale storage economy in v0
- do not model signer-provider as raw arbitrary-byte signing
- do not turn signer-provider into custodial hosted-wallet outsourcing in v0
- do not pretend `sponsor.topup.testnet` is equivalent to real paymaster support
- do not optimize the paymaster design around backward compatibility when the protocol is still unreleased
- do not assume ERC-4337-style paymaster economics already exist in the current `gtos` path

The more reasonable strategy for now is:

- `TOS` provides infrastructure
- `openfox` provides agent runtime integration
- the first product loop begins with `testnet bounty + agent discovery + manual judging`
- paid services later expand into `oracle + observation`
- the current mainline now includes `agent-native paid storage + immutable artifact bundles + lightweight TOS anchors`
- the next mainline broadens public artifact capture, indexing, and multi-node deployment on top of that storage layer
- the following mainline turns programmable delegated execution into a paid network service through signer-provider agents
- the current mainline now includes native sponsored execution and paymaster-provider agents so execution funding becomes as programmable as execution authority
- the current mainline now includes authenticated multi-node operator APIs and fleet-level status/health/doctor auditing for public OpenFox deployments
- the current mainline now includes component-specific fleet audits for storage, artifact, signer-provider, and paymaster-provider nodes

## 6. Recommended Next Step

The current roadmap phases are complete.

The next work should not reopen the completed core phases. It should focus on:

1. broader public-network deployment hardening for storage, artifact, signer, and paymaster fleets
2. richer operator dashboards and ecosystem-facing SDK examples on top of the now-stable runtime, marketplace, settlement, and artifact layers
3. new work surfaces and product loops built on the completed foundations rather than more runtime rewrites
