# OpenFox Integration Roadmap

## 1. Goal

The goal is not merely to make `openfox` "support another chain."

OpenFox is not a chat tool.

The goal is to make `openfox` into an agent platform on `TOS.network` whose
agents and operators can:

- discover real opportunities
- hold and use a `TOS` wallet
- sign and send transactions on the `TOS` network
- take jobs and perform oracle and observation work
- get paid for real services through `x402` and native `TOS` flows
- issue rewards and payouts to other agents
- call, hire, and coordinate other agents through discovery and provider
  surfaces
- store result bundles, publish proofs, and settle work on and off chain

In one sentence:

`openfox` should become an agent platform on `TOS.network` that can discover
opportunities, take work, get paid, issue rewards, call other agents, and
complete proof and settlement flows.

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

### Phase 10: Public Fleet Operator Packaging

Status: completed

Goal:

- package the existing multi-node operator API, fleet, and dashboard surfaces
  into one reusable bundle for public deployments

Delivered surface:

- `public-fleet-operator` bundled template
- reusable `fleet.yml` manifest skeleton
- dashboard export helper script
- operator notes for status, doctor, repair, and dashboard review

Acceptance criteria:

- operators can export one ready-made bundle with `openfox templates export public-fleet-operator`
- the bundle contains a valid fleet manifest skeleton
- the bundle contains a repeatable dashboard export flow
- the bundle is covered by template tests and linked from the main docs

### Phase 11: Ecosystem-Facing SDK Example Packs

Status: completed

Goal:

- publish direct builder examples for `tosdk` so third-party integrators can
  use native wallets, provider clients, and receipt helpers without reading
  OpenFox internals

Delivered surface:

- `tosdk/examples/network-wallet.ts`
- `tosdk/examples/provider-clients.ts`
- `tosdk/examples/storage-and-artifacts.ts`
- updated `tosdk/README.md`
- updated OpenFox SDK surface docs

Acceptance criteria:

- third-party builders can find runnable example code for the native wallet path
- third-party builders can find example code for storage/artifact/signer/paymaster requester clients
- storage and artifact receipt hashing examples are part of the repository

### Phase 12: Public Fleet Manifest Hardening

Status: completed

Goal:

- catch common public-fleet operator mistakes before any status, doctor, repair,
  or dashboard run touches a misconfigured manifest

Delivered surface:

- `openfox fleet lint --manifest <path>`
- placeholder URL and placeholder auth-token detection
- duplicate node-name and duplicate base-URL detection
- warnings for missing roles, missing auth tokens, and non-HTTPS public endpoints
- operator guide updates for preflight linting

Acceptance criteria:

- operators can lint a fleet manifest before running status or repair commands
- lint findings are available in human-readable and JSON form
- the public fleet operator template works with the new lint flow

### Phase 13: Public Fleet Dashboard Bundles

Status: completed

Goal:

- turn fleet dashboard exports into one self-contained audit artifact that can
  be stored, shared, or consumed by higher-level operator tooling

Delivered surface:

- `openfox dashboard bundle --manifest <path> --output <dir>`
- copied fleet manifest in the bundle
- dashboard JSON in the bundle
- dashboard HTML in the bundle
- fleet lint JSON in the bundle

Acceptance criteria:

- operators can produce one directory with all dashboard artifacts in a single command
- the bundle includes both machine-readable and human-readable dashboard outputs
- the bundle includes a lint report for preflight operator review

The current core roadmap phases are complete.

The next work should not reopen the completed core phases. It should focus on:

1. broader public-network deployment hardening for storage, artifact, signer, and paymaster fleets
2. richer operator dashboards, wallet visibility, and finance reporting on top of the now-stable runtime, marketplace, settlement, and artifact layers
3. bounded fleet-control and autopilot surfaces for low-risk remote maintenance
4. new work surfaces and product loops built on the completed foundations rather than more runtime rewrites

The latest completed slice under this next stage is:

- `openfox templates export public-fleet-operator --output ...`
- `openfox dashboard show --manifest ...`
- `openfox dashboard export --manifest ... --format json|html`
- reusable fleet dashboard snapshots and HTML exports for public operator fleets
- reusable `tosdk` signer-provider and paymaster-provider requester clients for
  third-party builders
- `openfox wallet report` and `openfox finance report`
- `openfox fleet wallet --manifest ...` and `openfox fleet finance --manifest ...`
- wallet and finance sections in operator dashboards and fleet exports

The next operator-focused design target is documented in:

- `docs/OpenFox-Operator-Box-Design.md`

The next owner-focused design target is documented in:

- `docs/OpenFox-Strategy-Opportunity-Reporting-Design.md`

### Phase 14: Operator Wallet and Finance Snapshots

Status: completed

Goal:

- give every OpenFox node a standard wallet and finance report that can be
  consumed locally, through the operator API, and across a fleet

Delivered surface:

- `GET /operator/wallet/status`
- `GET /operator/finance/status`
- `openfox wallet report`
- `openfox finance report`
- `openfox fleet wallet --manifest <path>`
- `openfox fleet finance --manifest <path>`
- dashboard sections for wallet balances, revenue, cost, and net profit

Implementation tasks:

- add finance projection helpers that combine wallet, payment, settlement,
  market, spend-tracking, inference-cost, and on-chain transaction data
- define a normalized per-node wallet snapshot schema
- define a normalized per-node finance snapshot schema
- expose wallet and finance snapshots through authenticated operator endpoints
- add human-readable and JSON CLI reports for single-node wallet and finance views
- add fleet aggregation and summaries for wallet and finance snapshots
- add tests for wallet and finance operator endpoints, CLI rendering, and fleet aggregation

Acceptance criteria:

- operators can see current balance, reserved balance, available balance, and
  runway per node
- operators can see revenue, cost, and net profit for today, 7 days, and 30 days
- operators can inspect pending receivables, pending payables, and retryable
  failed items per node
- wallet and finance data are available in human-readable and JSON form

Delivered so far:

- authenticated operator API endpoints for wallet and finance snapshots
- `openfox wallet report` and `openfox finance report`
- `openfox fleet wallet` and `openfox fleet finance`
- wallet and finance sections in fleet dashboard snapshots and exports

### Phase 15: Fleet FinOps and Profit Attribution

Status: completed

Goal:

- turn raw runtime records into role-aware fleet economics so operators know
  which nodes and services actually make money

Delivered surface:

- node, role, capability, and customer revenue breakdowns
- cost-category and margin breakdowns
- `openfox fleet payments --manifest <path>`
- `openfox fleet settlement --manifest <path>`
- `openfox fleet market --manifest <path>`
- finance sections in dashboard JSON, HTML, and bundle exports

Implementation tasks:

- add attribution rules for revenue and cost by node, role, capability,
  customer, provider, request key, and subject identifier
- normalize pending and confirmed states across payments, settlement callbacks,
  market callbacks, signer submissions, and paymaster authorizations
- compute per-role profit views for gateway, host, solver, storage, artifact,
  signer, and paymaster nodes
- add fleet payment, settlement, and market summary commands backed by the new
  finance projections
- extend dashboard exports with receivables, liabilities, margin, and negative-profit warnings
- add tests for attribution correctness and dashboard finance exports

Acceptance criteria:

- operators can rank nodes and roles by revenue, cost, and net margin
- operators can identify top customers, top capabilities, and top loss sources
- operators can see where pending callbacks or failed retries are delaying
  revenue recognition
- finance dashboards remain exportable as reusable audit artifacts

Delivered so far:

- `GET /operator/payments/status`
- `GET /operator/settlement/status`
- `GET /operator/market/status`
- `openfox fleet payments --manifest <path>`
- `openfox fleet settlement --manifest <path>`
- `openfox fleet market --manifest <path>`
- fleet dashboard JSON and HTML exports with:
  - role margin breakdowns
  - capability revenue and cost breakdowns
  - counterparty summaries
  - delayed settlement and market queue warnings

### Phase 16: Fleet Control and Queue Recovery

Status: completed

Goal:

- add bounded remote control actions so operators can recover revenue-affecting
  queues and safely steer degraded nodes without logging into each machine

Delivered surface:

- `POST /operator/control/pause`
- `POST /operator/control/resume`
- `POST /operator/control/drain`
- `POST /operator/control/retry/payments`
- `POST /operator/control/retry/settlement`
- `POST /operator/control/retry/market`
- `POST /operator/control/retry/signer`
- `POST /operator/control/retry/paymaster`
- `openfox fleet control <pause|resume|drain> --manifest <path> --node <name>`
- `openfox fleet retry <payments|settlement|market|signer|paymaster> --manifest <path>`

Implementation tasks:

- define authenticated mutation handlers for bounded control actions
- add queue-specific retry workers for payments, settlement, market, signer,
  and paymaster paths
- add audit logging for all remote control actions
- add safety checks for role, state, and maintenance intent before mutating a node
- add fleet CLI support for targeted node control and batch retry flows
- add tests for authorization, idempotency, and audit logging of control actions

Acceptance criteria:

- operators can pause, resume, or drain a node without direct shell access
- operators can recover eligible queues remotely through bounded authenticated APIs
- every mutation action leaves an auditable control record
- unsafe high-risk actions remain outside the automatic fleet-control surface

Delivered so far:

- `GET /operator/control/status`
- `GET /operator/control/events`
- `POST /operator/control/pause`
- `POST /operator/control/resume`
- `POST /operator/control/drain`
- `POST /operator/control/retry/payments`
- `POST /operator/control/retry/settlement`
- `POST /operator/control/retry/market`
- `POST /operator/control/retry/signer`
- `POST /operator/control/retry/paymaster`
- `openfox fleet control <pause|resume|drain> --manifest <path> [--node <name>]`
- `openfox fleet retry <payments|settlement|market|signer|paymaster> --manifest <path> [--node <name>]`
- runtime status reporting for paused and drained nodes
- doctor warnings for drained operator nodes
- persistent operator control event audit records

### Phase 17: Conservative Autopilot Policies

Status: completed

Goal:

- let operator-box automate low-risk maintenance while keeping treasury and
  policy expansion under explicit approval

Delivered surface:

- operator automation policies for retries, renewals, verification catch-up,
  and provider quarantine
- approval-gated policies for treasury, spend-cap, and signer or paymaster policy changes
- control-event reporting in dashboards and audit bundles
- `operatorAutopilot` runtime configuration with bounded queue, maintenance,
  and provider-quarantine thresholds
- built-in `operator_autopilot` heartbeat task
- `GET /operator/autopilot/status`
- `GET /operator/autopilot/approvals`
- `POST /operator/autopilot/run`
- `POST /operator/autopilot/approvals/request`
- `POST /operator/autopilot/approvals/:id/approve`
- `POST /operator/autopilot/approvals/:id/reject`
- `POST /operator/control/maintain/storage`
- `POST /operator/control/maintain/artifacts`
- `POST /operator/control/quarantine/provider`
- `openfox autopilot status|run|approvals|request|approve|reject`
- dashboard bundle exports for:
  - `control-events.json`
  - `autopilot.json`
  - `approvals.json`

Implementation tasks:

- define policy rules for low-risk automated maintenance triggers
- add threshold-based actions for queue backlogs, lease-health failures, and
  provider degradation
- add approval workflows for high-risk actions
- persist operator control events for audit and post-incident review
- extend dashboard bundles with automation and control-event reports
- add tests for rule triggering, suppression, approval gates, and audit trails

Acceptance criteria:

- operators can enable bounded automation for common low-risk maintenance paths
- automation never widens treasury or execution authority without approval
- audit bundles explain what the operator box did, when it did it, and why

### Phase 18: Sponsor Campaigns on Top of the Task Marketplace

Status: completed

Goal:

- add a sponsor-facing grouping layer above individual bounties so operators
  can run coherent campaigns with one budget and one progress view without
  splitting the marketplace into a second parallel system

Delivered surface:

- persistent `campaign` records in the OpenFox marketplace database
- `campaign_id` binding on bounties
- `GET /campaigns`
- `POST /campaigns`
- `GET /campaigns/:id`
- `openfox campaign list`
- `openfox campaign status <campaign-id>`
- `openfox campaign open --title ... --description ... --budget-wei ...`
- campaign-aware opportunity scouting and reports

Implementation tasks:

- add a campaign record type with budget, allowed task kinds, and bounded
  open-bounty counts
- add campaign-aware bounty creation rules so budget and kind limits are
  enforced inside the existing bounty engine
- add local and remote campaign inspection surfaces through CLI and HTTP
- surface campaign progress as allocated budget, remaining budget, bounty
  count, open-bounty count, paid-bounty count, and submission count
- include campaigns in opportunity scouting so sponsors and solver agents can
  discover grouped work programs, not only one-off tasks
- add tests for campaign CRUD, budget enforcement, and campaign HTTP/scout
  flows

Acceptance criteria:

- sponsors can create one campaign with a fixed budget and allowed task kinds
- hosts can open multiple bounties under one campaign until the campaign
  budget or open-bounty cap is exhausted
- operators can inspect a campaign and see its bounties plus progress in one
  response
- opportunity scouting can see campaign-level work surfaces in addition to
  one-off bounties

### Phase 19: Strategy Profiles and Opportunity Ranking

Status: completed

Goal:

- let the owner define a bounded earning strategy and see ranked
  `TOS.network` opportunities that fit it

Delivered surface:

- `openfox strategy show|set|validate`
- `openfox scout list`
- `openfox scout rank`
- persisted strategy profiles
- scored opportunity snapshots
- local strategy persistence in OpenFox state
- normalized opportunity scoring across campaigns, bounties, and provider surfaces
- strategy-fit flags and ranking breakdowns in `scout rank --json`

Implementation tasks:

- define a strategy schema for revenue target, spend limits, margin threshold,
  enabled opportunity classes, provider classes, automation level, and report cadence
- persist strategy profiles in local state
- extend scout ingestion to normalize bounties, paid providers, sponsored
  execution, and subcontractable agent work into one opportunity model
- add scoring and ranking based on payout, estimated cost, margin, deadline,
  trust, and policy fit
- add tests for strategy validation and opportunity ranking behavior

Acceptance criteria:

- owners can define a bounded strategy instead of relying on ad-hoc prompts
- OpenFox can rank opportunities by expected economic value and policy fit
- owners can distinguish between all discovered opportunities and strategy-matched opportunities

### Phase 20: Owner Finance Ledger and Daily Snapshots

Status: completed

Goal:

- turn OpenFox activity into a deterministic owner-facing earnings ledger with
  daily and weekly finance snapshots

Delivered surface:

- owner finance snapshot schema
- daily finance snapshot schema
- weekly finance snapshot schema
- `openfox report daily --json`
- `openfox report weekly --json`
- deterministic owner finance snapshots with realized and pending value splits
- persisted owner finance snapshot records in local state
- top gains, top losses, anomaly detection, and category attribution

Implementation tasks:

- unify wallet balance, `x402` payments, rewards, provider costs, settlement,
  receivables, payables, and on-chain spend into one owner ledger projection
- compute daily and weekly totals for spend, revenue, net change, pending value,
  and major cost categories
- attribute gains and losses back to jobs, opportunities, providers, and rewards
- persist daily and weekly snapshot records
- add tests for finance projection correctness and snapshot generation

Acceptance criteria:

- owners can see how much `TOS` was spent and earned today
- owners can separate realized value from pending or expected value
- owners can identify the top profitable and top loss-making activities

### Phase 21: LLM-Generated Reports and Recommendations

Status: completed

Goal:

- use configured model providers such as OpenAI and Anthropic to turn
  deterministic system snapshots into readable owner reports and next-step
  recommendations, while those same providers continue to support normal
  OpenFox runtime work

Delivered surface:

- generated daily and weekly report objects
- opportunity digest summaries
- anomaly and recommendation summaries
- report-generation audit metadata
- deterministic fallback report generation when no inference backend is configured
- persisted report-generation audit records with provider, model, and input hash

Implementation tasks:

- define a structured report input object that combines strategy, opportunity,
  and finance snapshots
- define deterministic system API and ledger inputs for report generation
- add report-generation pipelines that call configured LLM providers
- keep machine-verifiable totals separate from generated prose
- record model provider, model name, and generation timestamp for each report
- add tests that verify report generation uses structured inputs and preserves deterministic totals

Acceptance criteria:

- owners receive readable daily and weekly summaries without reading raw tables
- report prose explains gains, losses, and next opportunities without becoming
  the source of financial truth
- report generation consumes deterministic system data instead of free-form
  model memory or prompt-only reconstruction
- OpenFox can generate recommendations about what to pursue next under the current strategy

### Phase 22: Owner Delivery Surfaces

Status: completed

Goal:

- let the owner review reports and opportunity digests from a phone through web
  and email delivery

Delivered surface:

- mobile-friendly owner web page
- owner report email digest
- report delivery logs
- `openfox report send --channel <email|web>`
- `openfox report list|get|deliveries`
- embedded owner report web server with latest daily and weekly views
- scheduler-driven morning, end-of-day, weekly, and anomaly-triggered delivery hooks

Implementation tasks:

- define a shared owner-report rendering schema for web and email
- add a mobile-friendly web surface for daily finance, active work, and opportunity digests
- add email rendering and delivery for scheduled daily and weekly reports
- add scheduling hooks for morning, end-of-day, and anomaly-triggered report delivery
- add tests for report rendering, delivery logging, and delivery scheduling

Acceptance criteria:

- owners can review finance and opportunity reports from a phone without opening the terminal
- web and email views render from the same underlying report object
- owners can receive routine and anomaly-driven report delivery
