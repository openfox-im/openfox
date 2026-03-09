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

The recommended path is to move in six stages, with one narrow MVP stage inserted between the completed core path and the broader onboarding/productization work.

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
- `openfox wallet bootstrap-signer --type ed25519`
- improved native wallet error guidance for RPC, balance, nonce, and signer metadata issues

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

Status: in progress

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

Still pending in this phase:

- contract-native task/query market contracts

### Phase 4: Productionize the x402 Server Side

Status: not complete

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

### Phase 5: Ecosystem and SDK Productization

Status: not complete

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

## 4. Near-Term Priorities

Suggested priority order:

### P0: Do Immediately

- launch the first real paid service on top of the existing marketplace/runtime base
- start with one narrow paid API that produces a real result
- add payment idempotency and stronger payment-to-result binding
- run one real paid flow end to end on testnet

### P1: Do Next

- design on-chain query/job identifiers and result callback interfaces
- improve production payment recovery and replay handling
- add contract-level task and oracle settlement adapters

### P2: Do Later

- extract `tos-agent-kit`
- write developer documentation for testnet usage
- build operator onboarding materials

## 5. What Not to Do Yet

- do not start with a general agent execution marketplace
- do not start with a complex oracle dispute system
- do not start with a full `zkTLS + SNARK` proof pipeline
- do not push all application logic into native chain modules

The more reasonable strategy for now is:

- `TOS` provides infrastructure
- `openfox` provides agent runtime integration
- the first product loop begins with `testnet bounty + agent discovery + manual judging`
- paid services later expand into `oracle + observation`

## 6. Recommended Next Step

There are only two next steps that matter most:

1. launch the first real paid service on top of the current runtime and marketplace base
2. make a new operator able to complete `setup -> fund -> discover provider -> pay in TOS -> receive a real service result`

Only after these two steps are complete should we expand into broader paid service and oracle-facing phases.
