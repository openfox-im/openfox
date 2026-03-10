# OpenFox Task Overview

This file tracks the runtime refactor priorities that should not get lost while
building OpenFox into a TOS-native agent platform.

## Current Priorities

- [x] Task 1: Rebuild the skills system around a repo-native skill catalog
  - Status: Complete
  - Goal: Move OpenFox away from inline default skills and direct skill
    instruction injection toward a bundled/managed/workspace skill snapshot model
    inspired by OpenClaw.
- [x] Task 2: Productize heartbeat, cron, and operator UX
  - Status: Complete
  - Goal: Keep the always-on OpenFox runtime, but expose scheduling, status,
    wakeups, and operator controls in a cleaner product surface.
- [x] Task 3: Finish gateway and service operator UX
  - Status: Complete
  - Goal: Keep the existing discovery/gateway protocol line, then improve
    deployment, health checks, service management, and operational examples.
- [x] Task 4: Add managed service install and lifecycle UX
  - Status: Complete
  - Goal: Make OpenFox easier to run as an always-on user service with
    install/start/stop/restart/uninstall flows closer to OpenClaw.
- [x] Task 5: Add doctor and health diagnostics UX
  - Status: Complete
  - Goal: Give operators a one-command way to inspect config, wallet,
    inference, RPC, service state, and next-step repair guidance.
- [x] Task 6: Add model/provider status UX
  - Status: Complete
  - Goal: Make provider readiness visible with an operator command similar to
    OpenClaw's model status surface, without expanding the provider matrix.
- [x] Task 7: Add onboarding command UX
  - Status: Complete
  - Goal: Provide an OpenClaw-style onboarding entrypoint that can initialize
    OpenFox and optionally install the managed service in one flow.
- [x] Task 8: Add logs operator UX
  - Status: Complete
  - Goal: Give operators a direct way to inspect recent OpenFox runtime logs
    without leaving the CLI.
- [x] Task 9: Add machine-readable runtime status surfaces
  - Status: Complete
  - Goal: Expose heartbeat, cron, service, gateway, and top-level runtime
    status as stable JSON snapshots for automation, dashboards, and future
    control plane integrations.
- [x] Task 10: Build the first bounty host/solver runtime slice
  - Status: Complete
  - Goal: Turn the bounty architecture into a working bounded-task loop with
    local judging, native payout, HTTP host endpoints, and automated solver
    flows.
- [x] Task 11: Generalize bounty into a task marketplace slice
  - Status: Complete
  - Goal: Move beyond a single question-only bounty and support multiple task
    kinds through one reusable engine, HTTP API, CLI surface, and skill-driven
    host/solver flow.
- [x] Task 12: Add non-question task skills
  - Status: Complete
  - Goal: Add bundled task skills beyond the original question flow so OpenFox
    can host and solve translation, social proof, and third-party
    problem-solving work without changing the core engine.
- [x] Task 13: Add third-party problem solving, social bounty, and translation flows
  - Status: Complete
  - Goal: Make "ask another agent to solve something useful" a first-class path
    instead of a one-off question demo.
- [x] Task 14: Add TOS opportunity scout and earning surfaces
  - Status: Complete
  - Goal: Give OpenFox a direct way to discover and rank bounty, provider, and
    sponsored capability opportunities on the network.
- [x] Task 15: Improve deployment and local multi-node integration
  - Status: Complete
  - Goal: Add an explicit local multi-role operator path for host, solver, and
    scout roles instead of relying on ad-hoc shell setup.
- [x] Task 16: Add MVP anti-abuse and policy closure
  - Status: Complete
  - Goal: Add the first production-style guardrails around payouts and solver
    submissions so the marketplace slice is not wide open by default.
- [x] Task 17: Launch the first real paid observation service
  - Status: Complete
  - Goal: Turn the existing `observation.once` provider into a real paid
    service with stable request/result semantics, payment idempotency, and job
    retrieval instead of a one-off test payload flow.
- [x] Task 18: Launch the first paid oracle resolution service
  - Status: Complete
  - Goal: Add a narrow paid oracle-style service on top of the same TOS-native
    runtime base without importing a full decentralized oracle protocol.
- [x] Task 19: Add standard settlement receipts and on-chain anchors
  - Status: Complete
  - Goal: Publish canonical result receipts for bounty, observation, and oracle
    flows, then anchor them on-chain through native TOS transactions.
- [x] Task 20: Add settlement operator UX and diagnostics
  - Status: Complete
  - Goal: Make settlement state visible and inspectable through CLI, status,
    doctor, and roadmap/operator docs.
- [x] Task 21: Add contract callback adapters for settlement receipts
  - Status: Complete
  - Goal: Bind completed bounty, observation, and oracle results to
    contract-owned state through reusable native callback adapters instead of
    leaving settlement purely as an anchor log.
- [x] Task 22: Add scheduler-driven settlement callback retries
  - Status: Complete
  - Goal: Use the OpenFox heartbeat scheduler to confirm and retry pending
    settlement callbacks so contract binding survives temporary RPC or receipt
    timing failures.
- [x] Task 23: Add contract-native market bindings for task and query creation
  - Status: Complete
  - Goal: Bind bounty openings, observation jobs, and oracle requests to
    contract-owned state at creation time, not only at final settlement time.
- [x] Task 24: Add operator UX and heartbeat retries for market callbacks
  - Status: Complete
  - Goal: Make market bindings and contract callback delivery visible,
    inspectable, and retryable through the same operator/runtime surfaces used
    for settlement callbacks.
- [x] Task 25: Add a durable server-side x402 payment ledger
  - Status: Complete
  - Goal: Turn paid provider requests into recoverable, replay-safe, auditable
    payment flows backed by persistent payment records instead of transient
    request handling.
- [x] Task 26: Add operator UX and heartbeat retries for x402 payments
  - Status: Complete
  - Goal: Make server-side x402 payments inspectable, retryable, and visible
    through CLI, status, health, and doctor surfaces just like settlement and
    market callbacks.
- [x] Task 27: Publish third-party quickstarts and runtime guides
  - Status: Complete
  - Goal: Let a new external builder complete the basic setup, funding,
    runtime, and paid-service flow without reading internal source files.
- [x] Task 28: Add bundled template catalog and export UX
  - Status: Complete
  - Goal: Ship reusable config and operator templates so third-party users can
    start from working deployment shapes instead of building from scratch.
- [x] Task 29: Add web4.ai, MCP, and API service integration examples
  - Status: Complete
  - Goal: Document how OpenFox plugs into adjacent agent and API ecosystems
    without expanding the runtime into unrelated abstractions.
- [x] Task 30: Add task sponsor and service operator example packs
  - Status: Complete
  - Goal: Provide concrete example stacks for sponsors, providers, gateways,
    and local host/solver/scout deployments.
- [x] Task 31: Publish SDK/runtime surface guidance and close Phase 5
  - Status: Complete
  - Goal: Clarify when builders should use `tosdk` directly versus the OpenFox
    runtime, and close the roadmap’s ecosystem/productization phase.
- [x] Task 32: Implement OpenFox IPFS Market v0
  - Status: Complete
  - Goal: Add an agent-native, paid, immutable, TTL-based storage market for
    bundles and artifacts, with lightweight TOS anchors instead of large
    on-chain blobs.
- [x] Task 33: Implement verifiable public news and oracle bundles
  - Status: Complete
  - Goal: Build the first storage-backed artifact pipeline for public news
    capture, oracle evidence, committee votes, aggregate oracle reports, local
    verification, and lightweight native anchors.
- [x] Task 34: Harden multi-node deployment guidance for public artifact and marketplace roles
  - Status: Complete
  - Goal: Give operators a concrete deployment path for requester, provider,
    gateway, storage-provider, artifact capture, host, solver, and scout roles
    across local and public nodes.
- [x] Task 35: Broaden artifact verification and indexing around anchored bundles
  - Status: Complete
  - Goal: Make anchored and verified public bundles easier to search, inspect,
    and operate through CLI, service surfaces, and persistent indexes.
- [x] Task 36: Add sponsor and bounty flows for public evidence capture
  - Status: Complete
  - Goal: Support both sponsored capture endpoints and bounty-driven evidence
    capture so OpenFox can gather public news and oracle evidence without
    manual runtime rewrites.
- [x] Task 36A: Add storage lease lifecycle automation
  - Status: Complete
  - Goal: Extend the first storage market slice with renewal, replication, and
    scheduler-driven lease health maintenance so stored bundles can survive as
    long-lived operator assets.
- [x] Task 37: Define the signer-provider protocol and wallet-policy profile
  - Status: Complete
  - Goal: Turn `tolang` programmable-wallet delegation into a stable OpenFox
    network protocol for bounded delegated execution, without falling back to
    custodial hosted-wallet behavior.
- [x] Task 38: Add a signer-provider service mode to OpenFox
  - Status: Complete
  - Goal: Let one OpenFox node act as a paid signer-provider that accepts
    bounded execution requests, submits them to `TOS`, and returns durable
    execution receipts.
- [x] Task 39: Add requester and remote-execution UX for signer-provider flows
  - Status: Complete
  - Goal: Let another OpenFox node discover a signer-provider, pay for one
    delegated execution, and use it beside the existing local-wallet path.
- [x] Task 40: Add signer-provider operator visibility, diagnostics, and docs
  - Status: Complete
  - Goal: Make signer-provider state visible through status/health/doctor/docs
    so programmable delegated execution becomes part of the same operator story
    as storage, artifacts, settlement, and paid services.
- [x] Task 41: Define the paymaster-provider protocol and sponsor-policy profile
  - Status: Complete
  - Goal: Turn native sponsored execution into a stable OpenFox/TOS protocol
    surface for bounded execution funding, without falling back to faucet or
    top-up workarounds.
- [x] Task 42: Add native sponsored transaction support across GTOS, tolang, and tosdk
  - Status: Complete
  - Goal: Add first-class sponsor-aware transaction semantics, validation, and
    client encoding so sponsor-side gas funding becomes native protocol
    behavior.
- [x] Task 43: Add a paymaster-provider service mode and requester UX to OpenFox
  - Status: Complete
  - Goal: Let one OpenFox node publish sponsorship capability and let another
    node discover it, obtain one sponsorship authorization, and execute a
    sponsored call through the native TOS path.
- [x] Task 44: Add paymaster-provider operator visibility, diagnostics, and docs
  - Status: Complete
  - Goal: Make sponsored execution state visible through status/health/doctor,
    service UX, and operator guides so paymaster-provider becomes part of the
    same runtime story as signer-provider and paid services.
- [x] Task 45: Add multi-node operator APIs and fleet auditing UX
  - Status: Complete
  - Goal: Make public storage, artifact, signer, and paymaster deployments
    easier to run and audit across multiple OpenFox nodes through a stable
    authenticated operator API and a fleet-level CLI surface.
- [x] Task 46: Add component-specific fleet audits for storage, artifacts, signer, and paymaster nodes
  - Status: Complete
  - Goal: Move beyond generic fleet reachability and expose per-component
    operator snapshots so public provider fleets can be audited by role, due
    work, and policy health instead of only by top-level runtime status.
- [x] Task 47: Add fleet repair and remote maintenance for storage and artifact nodes
  - Status: Complete
  - Goal: Turn fleet auditing into fleet remediation by exposing authenticated
    remote maintenance actions for storage lease upkeep and artifact
    verification/anchoring, then batch them through the fleet CLI.
- [x] Task 48: Add provider reputation and storage lease-health reporting
  - Status: Complete
  - Goal: Turn operator snapshots into stronger operating signals by exposing
    provider reputation summaries plus lease-level health state for storage,
    artifacts, signer, and paymaster roles through CLI, operator APIs, fleet
    audits, status, and doctor.
- [x] Task 49: Extract more reusable SDK surfaces for third-party storage and artifact clients
  - Status: Complete
  - Goal: Move more storage, artifact, audit, and anchor helpers into `tosdk`
    so third-party clients do not need to depend on OpenFox runtime internals.
- [x] Task 50: Bind signer receipts to storage and artifact audit trails
  - Status: Complete
  - Goal: Link delegated/sponsored execution receipts back into storage lease,
    artifact verification, and anchoring records so public operations have one
    auditable trail across execution, maintenance, and evidence.

## Task 1 Breakdown

- [x] Create a repository-native `skills/` directory with bundled skills.
- [x] Stop generating bundled skills from inline strings during setup.
- [x] Load skills from multiple sources with precedence:
  - `bundled < managed < workspace`
- [x] Build a compact skill snapshot for the model prompt.
- [x] Add a richer skills CLI and operator surface:
  - `openfox skills list`
  - `openfox skills status`
  - `openfox skills install`
  - `openfox skills enable/disable`
- [x] Add eligibility checks, richer metadata, and installation hints closer to
  the OpenClaw model.

## Task 2 Breakdown

- [x] Define a stable heartbeat status and scheduler UX.
- [x] Add a cron/task operator surface.
- [x] Expose runtime state, wake reasons, and scheduler history clearly.
- [x] Document the operator flow for always-on OpenFox agents.

## Task 3 Breakdown

- [x] Add service deployment examples for requester, provider, and gateway roles.
- [x] Add health checks and operational troubleshooting for gateway/service mode.
- [x] Add service management examples for local, LAN, and public deployments.
- [x] Make the gateway operator path easier to configure and inspect.

## Task 4 Breakdown

- [x] Add Linux user-systemd install and uninstall flows.
- [x] Add start/stop/restart lifecycle commands.
- [x] Surface managed service state in the operator CLI.
- [x] Document managed service installation and runtime expectations.

## Task 5 Breakdown

- [x] Add `openfox health` for a compact runtime health snapshot.
- [x] Add `openfox doctor` for actionable diagnostic findings and repair hints.
- [x] Cover config, wallet, inference, RPC, skills, heartbeat, and service state.
- [x] Support machine-readable `--json` output for future UI/control plane use.

## Task 6 Breakdown

- [x] Add `openfox models status`.
- [x] Show selected model/provider and provider readiness.
- [x] Support `--check` for local Ollama probing.
- [x] Support `--json` output for automation and future UI use.

## Task 7 Breakdown

- [x] Add `openfox onboard`.
- [x] Support `openfox onboard --install-daemon`.
- [x] Reuse the existing setup wizard instead of inventing a second init flow.
- [x] Keep onboarding compatible with the managed service lifecycle.

## Task 8 Breakdown

- [x] Add `openfox logs`.
- [x] Support `--tail` line count selection.
- [x] Point the operator to the managed service log path.

## Task 9 Breakdown

- [x] Add `--json` output to `openfox heartbeat status|tasks|history`.
- [x] Add `--json` output to `openfox cron list|status|runs`.
- [x] Add `--json` output to `openfox service status|check`.
- [x] Add `--json` output to `openfox gateway status|bootnodes|check`.
- [x] Add `openfox status --json` as a top-level machine-readable status
  surface.
- [x] Back the JSON output with explicit snapshot builders instead of ad-hoc
  report parsing.

## Task 10 Breakdown

- [x] Add bounty config and local database tables.
- [x] Add a core bounty engine with question-bounty lifecycle handling.
- [x] Add host-side HTTP endpoints for bounty create/list/get/submit/result.
- [x] Add host-side automatic judging and native payout hooks.
- [x] Add a minimal solver-side client and CLI surface.
- [x] Publish bounty host capability through Agent Discovery in a more explicit
  operator-facing way.
- [x] Add bundled bounty skills and defaults for host/solver mode.
- [x] Add README/operator documentation for running a host and solver pair.
- [x] Add host-side auto-open for one bounded question bounty.
- [x] Add solver-side automatic discovery/direct polling and auto-submit.
- [x] Generalize the bounty schema and engine from question-only to multi-kind.
- [x] Keep backward-compatible `question` aliases in the CLI while shifting the
  runtime to generic task fields.
- [x] Add auto-open and auto-solve compatibility with kind-specific skills.

## Task 11 Breakdown

- [x] Add generic task fields to bounty storage and runtime models.
- [x] Add schema migration for multi-kind bounty records and submissions.
- [x] Add a generic task open/submit/solve HTTP and CLI surface.
- [x] Keep the original question bounty path working as a compatibility layer.

## Task 12 Breakdown

- [x] Add bundled skills for translation host/solver.
- [x] Add bundled skills for social proof host/solver.
- [x] Add bundled skills for third-party problem-solving host/solver.
- [x] Add a bundled opportunity scout skill for ranking earning surfaces.

## Task 13 Breakdown

- [x] Support `translation` task bounties.
- [x] Support `social_proof` task bounties.
- [x] Support `problem_solving` task bounties.
- [x] Route solver prompts and judge prompts by task kind.

## Task 14 Breakdown

- [x] Add `opportunityScout` config.
- [x] Add an opportunity collector for remote tasks and discovery providers.
- [x] Add `openfox scout list`.
- [x] Add an operator-readable scout report.

## Task 15 Breakdown

- [x] Add a local multi-role wrapper script for host, solver, and scout roles.
- [x] Add a local task marketplace operator guide.
- [x] Keep the role wrapper isolated by `$HOME` so roles do not trample each
  other.

## Task 16 Breakdown

- [x] Add bounty policy configuration.
- [x] Enforce trusted proof URL checks for social proof tasks.
- [x] Enforce solver cooldown windows.
- [x] Enforce max auto-pay per solver per 24h.

## Task 17 Breakdown

- [x] Reuse the existing observation provider instead of inventing a second
  paid-service stack.
- [x] Add `POST /observe` as a stable paid observation request surface.
- [x] Add `GET /jobs/:id` for persisted observation result retrieval.
- [x] Bind duplicate requests to one stored job/result instead of charging
  again.
- [x] Persist a payment-bound observation result receipt with `job_id`,
  `result_url`, and `payment_tx_hash`.
- [x] Update runtime docs and roadmap state to reflect the first real paid
  service slice.

## Task 18 Breakdown

- [x] Add a narrow `POST /oracle/resolve` surface.
- [x] Add a minimal `POST /oracle/quote` surface.
- [x] Add a minimal `GET /oracle/result/:id` lookup surface.
- [x] Reuse the existing local-model judging path where possible.
- [x] Bind paid requests to stored oracle result receipts.
- [x] Keep the first oracle service bounded and TOS-native.

## Task 19 Breakdown

- [x] Add canonical settlement receipt and hashing helpers to `tosdk`.
- [x] Add persistent settlement receipt storage to OpenFox.
- [x] Add native settlement publication hooks for bounty results.
- [x] Add native settlement publication hooks for paid observation jobs.
- [x] Add native settlement publication hooks for paid oracle results.
- [x] Keep settlement publication idempotent per `(kind, subject_id)`.

## Task 20 Breakdown

- [x] Add `openfox settlement list|get`.
- [x] Surface settlement status in `openfox status`.
- [x] Add settlement findings to `openfox doctor` and `openfox health`.
- [x] Update roadmap and README so settlement is part of the visible operator
  surface.

## Task 21 Breakdown

- [x] Add settlement callback configuration for bounty, observation, and oracle.
- [x] Add persistent settlement callback records and operator-visible status.
- [x] Dispatch contract callbacks automatically after successful settlement
  publication.
- [x] Expose callback queue state through `openfox settlement callbacks`,
  `openfox status --json`, and diagnostics.

## Task 22 Breakdown

- [x] Add a built-in heartbeat task for pending settlement callback retries.
- [x] Confirm pending callbacks by polling chain receipts before resubmitting.
- [x] Back off and cap retry attempts for failed callback sends.
- [x] Surface pending/misconfigured callback state through `openfox doctor`.

## Task 23 Breakdown

- [x] Add canonical market binding and binding-hash helpers to `tosdk`.
- [x] Add package-call payload encoding helpers to `tosdk` for contract-native
  market callback delivery.
- [x] Add persistent market binding storage to OpenFox.
- [x] Publish contract-native market bindings for bounty creation.
- [x] Publish contract-native market bindings for paid observation requests.
- [x] Publish contract-native market bindings for paid oracle requests.
- [x] Keep market binding publication idempotent per `(kind, subject_id)`.

## Task 24 Breakdown

- [x] Add persistent market callback records and operator-visible status.
- [x] Add `openfox market list|get|callbacks`.
- [x] Surface market binding and callback status in `openfox status`.
- [x] Add market binding findings to `openfox doctor` and `openfox health`.
- [x] Add a built-in heartbeat task for pending market callback retries.
- [x] Confirm pending market callbacks by polling chain receipts before
  resubmitting.
- [x] Update roadmap and README so contract-native market binding is part of the
  visible operator/runtime surface.

## Task 25 Breakdown

- [x] Add persistent x402 payment storage and schema migration.
- [x] Add auditable request hashing and payment-to-result binding.
- [x] Add duplicate payment detection and replay protection.
- [x] Add recovery semantics after broadcast failure.
- [x] Add nonce replacement handling for same-request payment retries.
- [x] Add receipt-aware confirmation policy support.

## Task 26 Breakdown

- [x] Add a built-in heartbeat task for pending x402 payment retries.
- [x] Add `openfox payments list|get|retry`.
- [x] Surface x402 payment status in `openfox status`.
- [x] Add x402 payment findings to `openfox doctor` and `openfox health`.
- [x] Update roadmap and README so server-side x402 productionization is part
  of the visible operator/runtime surface.

## Task 27 Breakdown

- [x] Add a third-party quickstart for `setup -> fund -> discover -> pay -> receive result`.
- [x] Add explicit runtime/operator guides for external builders.
- [x] Link the quickstart and guides from the main README.

## Task 28 Breakdown

- [x] Add bundled third-party templates under a repository-native `templates/` directory.
- [x] Add `openfox templates list|show|export`.
- [x] Cover local marketplace, public provider, task sponsor, and quickstart entry templates.

## Task 29 Breakdown

- [x] Add integration guidance for web4.ai-style agent usage.
- [x] Add MCP integration guidance.
- [x] Add API service integration guidance.

## Task 30 Breakdown

- [x] Add a local marketplace example pack.
- [x] Add a public provider plus gateway example pack.
- [x] Add a task sponsor example pack.
- [x] Add operator-facing documentation that points to the right example pack for each role.

## Task 31 Breakdown

- [x] Add explicit SDK/runtime surface guidance that explains `tosdk` vs OpenFox.
- [x] Update the roadmap so Phase 5 is marked complete.
- [x] Update README so templates, quickstarts, and examples are part of the visible product surface.

## Task 32 Breakdown

- [x] Add canonical storage receipt and storage anchor hashing helpers to `tosdk`.
- [x] Add storage bundle canonicalization and deterministic `CID` generation.
- [x] Add persistent storage quote, lease, audit, and anchor tables to OpenFox.
- [x] Add a paid storage provider service with `quote`, `put`, `head`, `get`, and `audit` flows.
- [x] Add a storage client surface and `openfox storage ...` CLI.
- [x] Bind storage payments to issued lease receipts.
- [x] Add lightweight native storage anchors and persistent anchor records.
- [x] Publish storage capabilities through Agent Discovery and optional gateway routes.
- [x] Surface storage lease health through `status`, `service`, `health`, and `doctor`.
- [x] Add bundle/provider diagnostics and tests for the first storage-market slice.

## Task 33 Breakdown

- [x] Add canonical artifact receipt and anchor hashing helpers to `tosdk`.
- [x] Add artifact records, verification records, and anchor records to OpenFox.
- [x] Add `openfox artifacts list|get|capture-news|oracle-evidence|oracle-aggregate|committee-vote|verify|anchor`.
- [x] Add storage-backed public news capture flow with immutable bundle packaging.
- [x] Add storage-backed oracle evidence and aggregate packaging flows.
- [x] Add storage-backed committee vote packaging flow.
- [x] Add local verification receipts and persistent verification records.
- [x] Add lightweight native artifact anchors and persistent anchor records.
- [x] Surface artifact pipeline health through `status`, `health`, and `doctor`.
- [x] Add targeted tests for artifact hashing and artifact manager flows.

## Task 34 Breakdown

- [x] Add an explicit multi-node deployment guide for requester/provider/gateway/storage/artifact roles.
- [x] Keep deployment examples free of hardcoded user-specific home paths.
- [x] Link the new deployment guide from the roadmap-facing task tracker.

## Task 35 Breakdown

- [x] Add persistent artifact indexes for source URL, subject, and title.
- [x] Extend `openfox artifacts list` with query, source, subject, anchored, and verified filters.
- [x] Add targeted tests for artifact indexing and search behavior.
- [x] Surface artifact provider routes and health through service/operator UX.

## Task 36 Breakdown

- [x] Add a sponsored artifact capture server for public news and oracle evidence.
- [x] Publish sponsored artifact capture capabilities through discovery and gateway-backed routes.
- [x] Bind accepted public evidence bounties to the artifact pipeline so payouts and settlement can point at immutable bundles.
- [x] Add targeted tests for sponsored capture and bounty-driven artifact capture flows.

## Task 36A Breakdown

- [x] Add persistent storage renewal records and provider-bound lease metadata.
- [x] Add `openfox storage renew` and `openfox storage replicate`.
- [x] Add paid provider-side storage renewal handling.
- [x] Add scheduler-driven storage lease audit, renewal, and replication tasks.
- [x] Surface due renewals, recent renewals, and under-replicated bundles
  through `status`, `service`, `health`, and `doctor`.

## Task 37 Breakdown

- [x] Define canonical `signer.quote`, `signer.submit`, `signer.status`, and `signer.receipt` request/response objects.
- [x] Define a canonical `SignerPolicyRef` shape with `wallet_address`, `policy_hash`, `delegate_identity`, `scope_hash`, and expiry metadata.
- [x] Define a canonical signer-provider `trust_tier` model:
  - `self_hosted`
  - `org_trusted`
  - `public_low_trust`
- [x] Define the first supported wallet-policy profile for bounded delegated execution:
  - allowed target addresses
  - allowed function selectors
  - value caps
  - expiry
  - replay protection expectations
- [x] Map each `trust_tier` to default policy constraints so provider choice becomes an explicit risk profile instead of an informal trust judgment.
- [x] Define payment idempotency and payment-to-execution binding rules for signer-provider flows.
- [x] Define how signer-provider capability publication maps into Agent Discovery and optional Agent Gateway routes.
- [x] Document the funding boundary clearly:
  - `v0` assumes the programmable wallet already has enough `TOS` or uses a separate funding flow.
- [x] Keep the protocol explicitly execution-centric, not a raw arbitrary-byte signing API.

## Task 38 Breakdown

- [x] Add signer-provider config and local database tables for quotes, execution requests, and execution receipts.
- [x] Add a signer-provider HTTP service with bounded `quote`, `submit`, `status`, and `receipt` flows.
- [x] Reuse the existing paid-provider pattern so signer-provider requests can charge via `x402`.
- [x] Bind accepted payments to persisted signer execution receipts.
- [x] Add the first runtime path that submits a delegated programmable-wallet call to `TOS`.
- [x] Keep provider behavior constrained to delegated/session-key execution instead of root-key custody.
- [x] Add targeted tests for schema validation, idempotency, receipt persistence, and submission behavior.

## Task 39 Breakdown

- [x] Add a requester-side signer-provider client that can request a quote and submit one bounded execution request.
- [x] Add `openfox signer ...` CLI surfaces for provider discovery, quote, submit, and receipt lookup.
- [x] Add a remote delegated-execution path beside the current local wallet path instead of replacing it.
- [x] Support discovery-first invocation so a requester can find signer-provider agents through Agent Discovery.
- [x] Keep gateway compatibility so a signer-provider can sit behind Agent Gateway if needed.
- [x] Let the requester choose or enforce `trust_tier` during provider selection and invocation.
- [x] Add targeted tests for requester-side quote/submit/result flows.

## Task 40 Breakdown

- [x] Surface signer-provider routes, receipts, and recent execution state in `openfox status`.
- [x] Add signer-provider findings to `openfox health` and `openfox doctor`, especially for missing policy, expired delegation, or insufficient wallet funding.
- [x] Expose signer-provider service/operator state through the existing managed-service and service-status UX.
- [x] Document the operator flow for principal, requester, and signer-provider roles.
- [x] Surface the selected `trust_tier` and warn when a provider choice is too permissive for the intended execution scope.
- [x] Add a multi-node example showing programmable-wallet delegation plus signer-provider execution.
- [x] Link signer-provider docs back into the roadmap and operator-facing guides so the feature is part of the main runtime narrative.

## Task 41 Breakdown

- [x] Define canonical `paymaster.quote`, `paymaster.authorize`, `paymaster.status`, and `paymaster.receipt` request/response objects.
- [x] Define a canonical `PaymasterPolicyRef` shape with `sponsor_address`, `policy_hash`, wallet/target constraints, gas caps, and expiry metadata.
- [x] Define `sponsor_signer_type` as a first-class protocol field instead of leaving sponsor authorization implicitly bound to `secp256k1`.
- [x] Define a canonical paymaster-provider `trust_tier` model aligned with signer-provider:
  - `self_hosted`
  - `org_trusted`
  - `public_low_trust`
- [x] Define the first supported sponsor-policy profile for bounded native sponsored execution:
  - allowed requester wallets
  - allowed target addresses
  - allowed function selectors
  - max validation gas
  - max execution gas
  - max value
  - expiry
  - replay protection expectations
- [x] Define signer-type parity as a hard protocol requirement:
  - unified sponsor-aware native transactions must support the same `SignerType` set for both execution-side and sponsor-side authorization
  - this applies to both requester/execution signatures and sponsor/paymaster signatures
- [x] Define payment idempotency and payment-to-authorization binding rules for paymaster-provider flows.
- [x] Define how paymaster-provider capability publication maps into Agent Discovery and optional Agent Gateway routes.
- [x] Keep the protocol explicitly native sponsored execution, not a disguised top-up or faucet path.

## Task 42 Breakdown

- [x] Add a native sponsored transaction type or equivalent sponsor-aware transaction semantics in `gtos`.
- [x] Add sponsor identity, sponsor witness, sponsor nonce, sponsor expiry, and sponsor policy-hash fields to the native transaction model.
- [x] Add `sponsor_signer_type` to the native transaction model and hashing/signing path.
- [x] Update mempool and state-transition rules so sponsor-side balance and sponsor-side authorization replace requester-side gas funding.
- [x] Add first-class sponsor validation hooks in `gtos` and `tolang`.
- [x] Make unified sponsor-aware native transactions support the same `SignerType` matrix on both execution-side and sponsor-side authorization paths, rather than leaving sponsor-side signing locked to `secp256k1`.
- [x] Route both requester-side and sponsor-side verification through signer-type-aware verification code paths instead of hard-coded ECDSA-only helpers.
- [x] Add `tosdk` encoding, hashing, signing, and client support for native sponsored transactions.
- [x] Add targeted tests for sponsored validation, replay protection, rejection outside policy, and sponsor-funded execution paths.

## Task 43 Breakdown

- [x] Add paymaster-provider config and local database tables for sponsorship quotes, authorizations, and receipts.
- [x] Add a paymaster-provider HTTP service with bounded `quote`, `authorize`, `status`, and `receipt` flows.
- [x] Reuse the paid-provider pattern so paymaster-provider requests can charge via `x402` when appropriate.
- [x] Add a requester-side paymaster-provider client that can request a quote and obtain one bounded sponsorship authorization.
- [x] Add `openfox paymaster ...` CLI surfaces for provider discovery, quote, authorize, and receipt lookup.
- [x] Surface requester-side and sponsor-side signer types in paymaster authorization objects and CLI output so operators can confirm signer-type parity in practice.
- [x] Support composition across:
  - local wallet + paymaster-provider
  - signer-provider + paymaster-provider
  - combined signer-provider + paymaster-provider
- [x] Keep discovery-first invocation and optional gateway compatibility for paymaster-provider routes.

## Task 44 Breakdown

- [x] Surface paymaster-provider routes, authorizations, receipts, and recent sponsorship state in `openfox status`.
- [x] Add paymaster-provider findings to `openfox health` and `openfox doctor`, especially for missing sponsor policy, expired sponsorship windows, or insufficient sponsor funding.
- [x] Surface signer-type mismatch findings when sponsored execution falls back to narrower signer support than ordinary `SignerTxType`.
- [x] Expose paymaster-provider service/operator state through the existing managed-service and service-status UX.
- [x] Document the operator flow for requester, sponsor principal, and paymaster-provider roles.
- [x] Add a multi-node example showing signer-provider plus paymaster-provider composition.
- [x] Link paymaster-provider docs back into the roadmap and operator-facing guides so sponsored execution becomes part of the main runtime narrative.
