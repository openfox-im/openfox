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
- [x] Task 51: Add richer operator dashboard exports for public fleets
  - Status: Complete
  - Goal: Turn fleet/operator snapshots into reusable JSON and HTML dashboard
    exports so public storage, artifact, signer, and paymaster deployments are
    easier to inspect, share, and automate.
- [x] Task 52: Extract reusable signer and paymaster requester clients into `tosdk`
  - Status: Complete
  - Goal: Let third-party builders talk to signer-provider and
    paymaster-provider services through `tosdk` instead of depending on
    OpenFox runtime request code.
- [x] Task 53: Add a public fleet operator template and dashboard bundle
  - Status: Complete
  - Goal: Turn the existing fleet/operator/dashboard surfaces into a reusable
    exportable template for public multi-node deployments instead of leaving
    them as docs-only operator knowledge.
- [x] Task 54: Publish ecosystem-facing `tosdk` example packs
  - Status: Complete
  - Goal: Give third-party builders direct requester/provider/network examples
    for the native SDK so they do not need to read OpenFox runtime internals
    before integrating.
- [x] Task 55: Add fleet manifest linting for public operator bundles
  - Status: Complete
  - Goal: Catch placeholder URLs, duplicate node definitions, missing auth
    tokens, and non-HTTPS public endpoints before operators run public-fleet
    actions against a bad manifest.
- [x] Task 56: Add dashboard bundle exports for public fleets
  - Status: Complete
  - Goal: Export one self-contained audit bundle with the manifest copy,
    dashboard JSON, dashboard HTML, and lint report instead of requiring
    operators to stitch those artifacts together manually.
- [x] Task 57: Add sponsor-facing campaign grouping for the task marketplace
  - Status: Complete
  - Goal: Add a campaign layer above individual bounties so sponsors can group
    budgets, allowed task kinds, and progress reporting without introducing a
    second marketplace system.
- [x] Task 58: Add operator wallet and finance snapshots
  - Status: Complete
  - Goal: Give every OpenFox node a standard wallet and finance report that can
    be consumed locally, through the operator API, and across a fleet.
- [x] Task 59: Add fleet FinOps and profit attribution
  - Status: Complete
  - Goal: Turn operator wallet/finance snapshots plus payment, settlement, and
    market queues into role-aware fleet economics with dashboard-visible margin
    warnings and attribution summaries.
- [x] Task 60: Add bounded fleet control and queue recovery
  - Status: Complete
  - Goal: Let operators pause, resume, drain, and selectively retry
    revenue-affecting queues across a fleet through authenticated control
    endpoints instead of logging into each node manually.
- [x] Task 61: Add conservative operator autopilot policies
  - Status: Complete
  - Goal: Let operator boxes automate low-risk retries, maintenance, and
    provider quarantine while forcing treasury and policy-expansion changes
    through explicit approval requests and audit trails.
- [x] Task 62: Add strategy profiles and opportunity ranking
  - Status: Complete
  - Goal: Let owners persist a bounded earning strategy and rank discovered
    opportunities by value, cost, trust, deadline, and policy fit.
- [x] Task 63: Add owner finance snapshots and ledger reporting
  - Status: Complete
  - Goal: Turn OpenFox activity into a deterministic owner-facing ledger with
    daily and weekly finance snapshots, attribution, and anomaly summaries.
- [x] Task 64: Add generated owner reports and recommendations
  - Status: Complete
  - Goal: Turn deterministic owner finance and opportunity inputs into readable
    daily and weekly reports with audit metadata, while keeping machine totals
    as the source of truth.
- [x] Task 65: Add owner delivery surfaces for web and email
  - Status: Complete
  - Goal: Let operators review and deliver owner reports through CLI, a
    phone-friendly web surface, scheduled delivery hooks, and persisted
    delivery logs.
- [x] Task 66: Add owner approval inbox and mobile approval actions
  - Status: Complete
  - Goal: Let owners review and decide bounded approval requests from the same
    owner-facing web and CLI surfaces used for reports.
- [x] Task 67: Add owner opportunity alerts and action queue
  - Status: Complete
  - Goal: Let owners receive bounded, deduplicated opportunity alerts from
    scout and strategy inputs, then review and triage them through CLI, web,
    operator API, and heartbeat-driven generation flows.
- [x] Task 68: Add owner action requests from opportunity alerts
  - Status: Complete
  - Goal: Let owners turn one bounded opportunity alert into one bounded
    approval request without introducing a second approval system.
- [x] Task 69: Add an owner opportunity action journal
  - Status: Complete
  - Goal: Turn queued owner actions into auditable completed/cancelled action
    records with bounded resolution metadata instead of leaving them as
    one-bit queue items.
- [x] Task 70: Materialize approved owner opportunity actions into a bounded queue
  - Status: Complete
  - Goal: Turn approved `opportunity_action` requests into persistent,
    owner-visible queued actions that can be completed or cancelled through the
    same CLI, web, operator, heartbeat, and diagnostic surfaces.
- [x] Task 71: Add owner delegate and provider-call execution
  - Status: Complete
  - Goal: Let OpenFox execute bounded queued `delegate` owner actions against
    remote observation, oracle, and provider-style routes using the existing
    requester clients, then persist execution history beside the owner-action
    journal.
- [x] Task 72: Add public fleet control-plane bundles
  - Status: Complete
  - Goal: Turn the existing fleet, dashboard, and operator surfaces into
    reusable control-plane bundles for public multi-node OpenFox deployments.
- [x] Task 73: Add ecosystem SDK builder packs v2
  - Status: Complete
  - Goal: Make `tosdk` and OpenFox provider surfaces easier for third-party
    builders to consume without reading runtime internals.
- [x] Task 74: Add opportunity strategy execution loops
  - Status: Complete
  - Goal: Turn owner opportunity reporting from passive reporting into bounded
    execution loops that can queue, execute, and journal follow-up work across
    multiple opportunity classes.
- [x] Task 75: Replace news.fetch skeleton with bounded paid HTTP capture backend
  - Status: Complete
  - Goal: Return canonical URL, content hash, bounded article text, and bundle
    hash in news.fetch receipts.
- [x] Task 76: Replace proof.verify skeleton with bounded paid verifier backend
  - Status: Complete
  - Goal: Verify subject hashes, bundle hashes, and referenced receipt hashes
    inside fetched bundle payloads.
- [x] Task 77: Add TTL and expiry policy to agent-discovery storage
  - Status: Complete
  - Goal: Surface expiry timestamps in stored object receipts and prune expired
    objects on read.
- [x] Task 78: Add coordinator-side M-of-N evidence workflow
  - Status: Complete
  - Goal: Compose news.fetch, proof.verify, and storage.put into one
    operator-visible workflow with durable local state.
- [x] Task 79: Move provider backends behind versioned skill-composed interfaces
  - Status: Complete
  - Goal: Separate stable provider shells from versioned business-logic backends
    with skills_first as the default mode.
- [x] Task 80: Add fleet public-network hardening
  - Status: Complete
  - Goal: Add fleet-level lease/audit/renewal/replication reconciliation,
    provider liveness and failure-domain reporting, bounded recovery flows, and
    multi-node validation suites for public-role deployments.
- [x] Task 81: Expand ecosystem SDK builder packs
  - Status: Complete
  - Goal: Expand tosdk examples into fuller builder starter packs, add reusable
    SDK surfaces for delegated execution, evidence, and operator-control, publish
    versioned schema/reference exports, and add validation and drift detection.
- [x] Task 82: Add new work surfaces and product loops
  - Status: Complete
  - Goal: Add new reusable work surfaces across bounty/task (data_labeling),
    provider-service (sentiment.analyze), and owner-opportunity categories,
    packaged with skills, templates, docs, and operator commands.
- [x] Task 83: Add fleet incident observability and bounded remediation
  - Status: Complete
  - Goal: Add canonical public-fleet incident snapshots, alert delivery,
    bounded remediation, and incident-history exports for audits and
    postmortems.
- [x] Task 84: Add contract and operator control-plane packs
  - Status: Complete
  - Goal: Publish versioned control-plane bundles, reusable policy packs,
    clearer contract-facing manifests, and validation tooling for external
    automation systems.
- [x] Task 85: Productize evidence and oracle market flows
  - Status: Complete
  - Goal: Package reusable evidence/oracle flows with templates, skills,
    operator commands, owner-facing summaries, and end-to-end packaged
    validation.

## Task 53 Breakdown

- [x] Add a `public-fleet-operator` bundled template.
- [x] Add a reusable `fleet.yml` manifest skeleton with public role placeholders.
- [x] Add dashboard export helper scripts and operator notes.
- [x] Cover template export with tests.
- [x] Update template docs and roadmap references.

## Task 54 Breakdown

- [x] Add `tosdk/examples` with native wallet/client examples.
- [x] Add provider-client examples for storage, artifact, signer, and paymaster flows.
- [x] Add storage/artifact receipt hashing examples.
- [x] Update `tosdk/README.md` and OpenFox SDK surface docs to point to the examples.

## Task 55 Breakdown

- [x] Add `openfox fleet lint --manifest <path>`.
- [x] Detect placeholder URLs and placeholder auth tokens.
- [x] Detect duplicate node names and duplicate base URLs.
- [x] Warn on missing roles, missing auth tokens, and non-HTTPS public endpoints.
- [x] Add tests and operator docs for manifest linting.

## Task 56 Breakdown

- [x] Add `openfox dashboard bundle --manifest <path> --output <dir>`.
- [x] Include a manifest copy in the export.
- [x] Include dashboard JSON and HTML in the export.
- [x] Include a fleet lint JSON report in the export.
- [x] Add tests and dashboard-guide updates for bundle export.

## Task 57 Breakdown

- [x] Add persistent campaign records with budget, allowed task kinds, and status.
- [x] Add `campaign_id` support to bounties without forking the marketplace engine.
- [x] Add `openfox campaign list|status|open`.
- [x] Add HTTP `GET/POST /campaigns` and `GET /campaigns/:id`.
- [x] Add campaign-aware opportunity scouting.
- [x] Add tests for campaign CRUD, budget enforcement, and HTTP/scout surfaces.

## Task 60 Breakdown

- [x] Add authenticated operator API mutation endpoints for:
  - `pause`
  - `resume`
  - `drain`
  - `retry_payments`
  - `retry_settlement`
  - `retry_market`
  - `retry_signer`
  - `retry_paymaster`
- [x] Persist operator control events for audit history.
- [x] Add runtime and doctor visibility for paused and drained nodes.
- [x] Add `openfox fleet control ...` and `openfox fleet retry ...`.
- [x] Add API and fleet tests for authorization, idempotency, and queue retry surfaces.

## Task 61 Breakdown

- [x] Add `operatorAutopilot` runtime config with bounded retry, maintenance,
  and provider-quarantine thresholds.
- [x] Add a built-in `operator_autopilot` heartbeat task.
- [x] Add persistent operator approval request records and approval-state CRUD.
- [x] Add `openfox autopilot status|run|approvals|request|approve|reject`.
- [x] Add authenticated operator API surfaces for autopilot status, manual run,
  approval creation, and approval decisions.
- [x] Add low-risk direct control endpoints for storage maintenance, artifact
  maintenance, and provider quarantine.
- [x] Surface autopilot state through runtime status, doctor, and health.
- [x] Extend dashboard bundles with:
  - `control-events.json`
  - `autopilot.json`
  - `approvals.json`
- [x] Add targeted tests for rule triggering, cooldown suppression, approval
  flows, operator API endpoints, and dashboard bundle exports.

## Task 62 Breakdown

- [x] Define a local strategy profile schema with revenue target, spend cap,
  margin threshold, enabled opportunity kinds, enabled provider classes,
  allowed trust tiers, automation level, and report cadence.
- [x] Persist the current strategy profile in local OpenFox state.
- [x] Add `openfox strategy show|set|validate`.
- [x] Extend opportunity scouting to normalize campaigns, bounties, and
  discovery providers into one comparable opportunity model.
- [x] Add ranking based on payout, estimated cost, margin, deadline, trust,
  and policy fit.
- [x] Add `openfox scout rank`.
- [x] Add targeted tests for strategy persistence, validation, and ranking behavior.

## Task 63 Breakdown

- [x] Add owner finance snapshot types and persistence.
- [x] Build deterministic daily and weekly owner finance projections.
- [x] Separate realized and pending value in owner reports.
- [x] Attribute gains and losses back to jobs, providers, and rewards.
- [x] Add `openfox report daily --json` and `openfox report weekly --json`.
- [x] Add targeted tests for finance snapshot generation and ledger correctness.

## Task 64 Breakdown

- [x] Define a structured owner report input object that combines finance,
  strategy, and opportunity data.
- [x] Add generated daily and weekly owner report records with audit metadata.
- [x] Keep deterministic totals separate from generated narrative output.
- [x] Add deterministic fallback generation when no inference backend is available.
- [x] Add tests for generated report inputs, persistence, and recommendation output.

## Task 65 Breakdown

- [x] Add `openfox report list|get|deliveries|send`.
- [x] Add a mobile-friendly owner report web server with latest daily and
  weekly views.
- [x] Add email and web delivery rendering plus persisted delivery logs.
- [x] Add scheduler-driven generation and delivery hooks for morning,
  end-of-day, weekly, and anomaly-triggered delivery.
- [x] Add operator API surfaces for owner reports and deliveries.
- [x] Add tests for web delivery, email delivery, operator API, and scheduled delivery.

## Task 66 Breakdown

- [x] Add `openfox report approvals`.
- [x] Add `openfox report approve <request-id>`.
- [x] Add `openfox report reject <request-id>`.
- [x] Add owner-web approval inbox routes.
- [x] Add owner-web approve/reject action routes.
- [x] Add tests for approval listing and owner-web approval decisions.

## Task 67 Breakdown

- [x] Add persistent owner opportunity alert records and database indexes.
- [x] Generate owner alerts from scout and strategy-ranked opportunity inputs.
- [x] Add dedupe windows and bounded generation limits.
- [x] Add `openfox report alerts`.
- [x] Add `openfox report alerts-generate`.
- [x] Add `openfox report alert-read <alert-id>`.
- [x] Add `openfox report alert-dismiss <alert-id>`.
- [x] Add owner-web alert inbox routes plus read/dismiss actions.
- [x] Add operator API alert listing.
- [x] Add heartbeat-driven owner alert generation.
- [x] Surface owner-alert counts through status, health, and doctor.
- [x] Add targeted tests for generation, web delivery, operator API, and doctor visibility.

## Task 68 Breakdown

- [x] Add a bounded `opportunity_action` approval kind.
- [x] Add `openfox report alert-request-action <alert-id>`.
- [x] Add owner-web `POST /owner/alerts/:alertId/request-action`.
- [x] Link queued approval requests back to the originating alert record.
- [x] Mark unread alerts as read once an action request is queued.
- [x] Add targeted tests for queueing one action request from CLI/web-facing flows.

## Task 69 Breakdown

- [x] Add bounded resolution metadata to owner opportunity action records.
- [x] Let `openfox report action-complete` and `action-cancel` record result
  kind, result reference, and note metadata.
- [x] Add owner-web completion/cancellation payloads for result metadata.
- [x] Add operator API owner-action completion/cancellation routes.
- [x] Surface owner-action resolution references through status snapshots.
- [x] Add targeted tests for CLI/web/operator completion flows and recorded
  resolution metadata.

## Task 69 Breakdown

- [x] Add persistent owner opportunity action records and indexes.
- [x] Materialize approved `opportunity_action` approval requests into queued
  owner actions with one record per request.
- [x] Add `openfox report actions`.
- [x] Add `openfox report action-complete <action-id>`.
- [x] Add `openfox report action-cancel <action-id>`.
- [x] Add owner-web `GET /owner/actions`.
- [x] Add owner-web `POST /owner/actions/:actionId/complete`.
- [x] Add owner-web `POST /owner/actions/:actionId/cancel`.
- [x] Add operator API `GET /operator/owner/actions`.
- [x] Add heartbeat-driven synchronization from approved requests into queued
  owner actions.
- [x] Surface queued owner actions through `status`, `health`, and `doctor`.
- [x] Add targeted tests for materialization, owner-web actions, operator API,
  and diagnostics.

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

## Task 58 Breakdown

- [x] Add normalized operator wallet and finance snapshot builders.
- [x] Expose `GET /operator/wallet/status` and `GET /operator/finance/status`.
- [x] Add `openfox wallet report [--json]`.
- [x] Add `openfox finance report [--json]`.
- [x] Add `openfox fleet wallet --manifest <path> [--json]`.
- [x] Add `openfox fleet finance --manifest <path> [--json]`.
- [x] Add wallet and finance sections to fleet dashboard snapshots and exports.
- [x] Add tests for wallet/finance snapshots, operator endpoints, fleet aggregation, and dashboard exports.

## Task 59 Breakdown

- [x] Add operator payment, settlement, and market status snapshots for local nodes.
- [x] Expose `GET /operator/payments/status`, `GET /operator/settlement/status`, and `GET /operator/market/status`.
- [x] Add `openfox fleet payments --manifest <path> [--json]`.
- [x] Add `openfox fleet settlement --manifest <path> [--json]`.
- [x] Add `openfox fleet market --manifest <path> [--json]`.
- [x] Extend fleet dashboard snapshots and HTML exports with finance attribution, delayed-queue warnings, and role/capability/counterparty breakdowns.
- [x] Add tests for finops attribution, operator endpoints, fleet reports, and dashboard exports.

## Task 60 Breakdown

- [x] Add persistent owner-opportunity action execution records linked to queued owner actions.
- [x] Reuse the existing remote bounty and campaign requester clients for queued `pursue` action execution instead of inventing a second submission path.
- [x] Add `openfox report action-execute <action-id>` and `openfox report action-executions`.
- [x] Add owner web execution routes and execution-history inspection for owner reports.
- [x] Add operator API execution routes and execution-history listing for dashboards and control planes.
- [x] Add heartbeat-driven automatic owner action execution with bounded cooldown and per-run limits.
- [x] Surface owner-action execution state through `openfox status`, `openfox health`, and `openfox doctor`.
- [x] Add targeted tests for execution persistence, owner-web execution, and operator API execution flows.

## Task 71 Breakdown

- [x] Extend owner-action execution planning to support bounded `delegate` flows.
- [x] Reuse existing observation/oracle/provider requester clients for delegate execution instead of inventing a second provider protocol.
- [x] Persist delegate execution request/result/error state in owner-action execution records.
- [x] Surface delegate execution state through CLI, web, operator API, status, health, and doctor.
- [x] Add heartbeat-driven bounded automatic execution for eligible delegate actions.
- [x] Add targeted tests for delegated provider execution persistence and retries.

## Task 72 Breakdown

- [x] Add reusable public-fleet control-plane bundle consumers for manifest and dashboard exports.
- [x] Add stricter linting and validation for public operator manifests and role bundles.
- [x] Expose control-plane friendly JSON surfaces for fleet bundle consumption.
- [x] Publish one complete public-fleet operator bundle guide tied to the exported bundle format.

## Task 73 Breakdown

- [x] Expand `tosdk/examples` into richer requester/provider builder packs.
- [x] Add validation tooling so example packs stay runnable.
- [x] Add ecosystem-facing snippets for signer, paymaster, storage, artifact, and marketplace integrations.
- [x] Update SDK/runtime guidance so third-party builders can choose between `tosdk` and OpenFox more directly.

## Task 74 Breakdown

- [x] Connect owner opportunity reports and alerts to additional execution-capable opportunity classes.
- [x] Add bounded automatic follow-up loops for approved opportunity actions beyond the first queued execution.
- [x] Keep strategy execution state auditable and visible through existing status, health, doctor, and owner-report surfaces.
- [x] Add targeted tests for recommendation carry-forward and bounded follow-up execution loops.

## Task 75 Breakdown

- [x] Replace the `news.fetch` skeleton response with a bounded paid HTTP capture backend.
- [x] Return canonical URL, content hash, bounded article text, and bundle hash in `news.fetch` receipts.
- [x] Keep idempotent nonce replay handling and payment binding intact.
- [x] Add targeted tests for paid news capture and duplicate nonce replay.

## Task 76 Breakdown

- [x] Replace the `proof.verify` skeleton response with a bounded paid verifier backend.
- [x] Verify subject hashes, bundle hashes, and referenced receipt hashes inside fetched bundle payloads.
- [x] Return durable verifier receipt hashes and `valid|invalid|inconclusive` verdicts.
- [x] Add targeted tests for paid proof verification.

## Task 77 Breakdown

- [x] Add TTL and expiry policy to agent-discovery `storage.put/get`.
- [x] Surface expiry timestamps in stored object receipts and metadata lookups.
- [x] Prune expired discovery storage objects on read when configured.
- [x] Add targeted tests for expiry rejection and prune behavior.

## Task 78 Breakdown

- [x] Add a coordinator-side `M-of-N` evidence workflow that composes `news.fetch`, `proof.verify`, and `storage.put`.
- [x] Persist evidence workflow runs, source-level verification outcomes, and multi-recipient payment records in durable local state.
- [x] Add `openfox evidence run|list|get` so operators can execute and inspect bounded evidence workflows directly.
- [x] Add targeted end-to-end tests for `news.fetch -> proof.verify x N -> storage.put` with real paid provider surfaces.

## Task 79 Breakdown

- [x] Move `news.fetch`, `proof.verify`, and `storage.put/get` behind versioned provider backend interfaces.
- [x] Add bundled skill-composed backend stages and machine-readable contracts for `newsfetch.capture`, `zktls.bundle`, `proofverify.verify`, and `storage-object.put/get`.
- [x] Keep built-in execution available as a bounded fallback while making `skills_first` the default provider mode.
- [x] Surface provider backend mode and stage chains through service status, health, and doctor output.

## Task 80 Breakdown

- [x] Add fleet-level lease, audit, renewal, and replication reconciliation views for public-role deployments.
- [x] Add provider liveness, failure-domain, and degraded-route reporting to fleet dashboards and operator APIs.
- [x] Add bounded recovery flows for failed replication, degraded provider routes, and stuck callback queues.
- [x] Add multi-node validation suites covering restart, failover, and partial fleet degradation.

## Task 81 Breakdown

- [x] Expand `tosdk/examples` into fuller builder starter packs for requester, provider, gateway, marketplace, evidence, signer, paymaster, storage, and artifact roles.
- [x] Add more reusable SDK surfaces for delegated execution, evidence, and operator-control consumers.
- [x] Publish versioned schema/reference exports for core provider and operator API contracts.
- [x] Add validation and drift detection for builder packs and exported references.

## Task 82 Breakdown

- [x] Add new reusable work surfaces across bounty/task, provider-service, and owner-opportunity categories.
- [x] Package each new surface with bundled skills, templates, docs, and operator commands.
- [x] Reuse the existing marketplace, payment, settlement, artifact, and discovery foundations instead of introducing parallel engines.
- [x] Add end-to-end tests showing operators can launch and run each new surface with bounded configuration changes.

## Task 83 Breakdown

- [x] Add canonical fleet incident snapshots covering degraded nodes, failing routes, callback backlog growth, and replication drift.
- [x] Add operator alert policies and delivery channels for critical public-fleet health transitions.
- [x] Add bounded auto-remediation runs for common incident classes.
- [x] Add incident timeline/history exports and dashboard views for audits and postmortems.

## Task 84 Breakdown

- [x] Add versioned control-plane packs for external fleet automation and market operations.
- [x] Expand reusable policy-pack exports for signer, paymaster, storage, and marketplace roles.
- [x] Add clearer contract-facing callback/invocation examples and manifests.
- [x] Add validation tooling for control-plane packs and exported operator bundles.

## Task 85 Breakdown

- [x] Package reusable evidence/oracle market flows with templates, skills, operator commands, and provider defaults.
- [x] Add operator-facing result summaries for evidence cost, quorum, verification, and publication state.
- [x] Connect evidence/oracle outcomes into owner-facing action loops and reporting.
- [x] Add end-to-end validation for packaged evidence/oracle market deployments.

## Task 86 Breakdown

- Product mapping:
  - This task supports third-party verified-news and evidence-market products.
  - It is not limited to an OpenFox-operated media property.
- Implementation direction:
  - Treat `zktls.bundle` as a Rust-first CLI worker backend.
  - Prefer the upstream `tlsn` Rust crates from TLSNotary as the first real
    backend candidate.
  - Do not treat `tlsn-js` or `tlsn-wasm` as the primary Node.js execution
    path for v1 backend integration.
  - Do not implement the real zkTLS engine as a Node.js/TypeScript in-process
    prover.
  - Keep OpenFox responsible for the provider shell only:
    payment, anti-replay, persistence, operator visibility, and backend
    selection.
  - Invoke the real backend through a bounded CLI worker contract using
    `stdin/stdout`, deterministic exit codes, and explicit timeout and size
    limits.
- [x] Define a versioned `zktls.bundle` backend contract with canonical input/output schemas.
- [x] Add a Rust-first CLI worker adapter behind the existing `news.fetch` provider shell.
- [x] Add bounded source-policy configuration for allowlisted major news and public-information sites.
- [x] Persist zkTLS bundle metadata, origin claims, verifier-material references, and integrity hashes in durable local state.
- [x] Surface zkTLS backend readiness, source-policy coverage, and bundle health through service status, `doctor`, and operator APIs.
- [x] Add end-to-end tests for paid `news.fetch -> zktls.bundle` runs with deterministic fixtures and replay/idempotency coverage.
- Progress already landed:
  - A versioned CLI worker contract for `zktls.bundle` is defined in `OpenFox-CLI-Worker-Contracts-v0.md`.
  - The `news.fetch` skill path can now invoke a configured bounded CLI worker and fall back to the existing built-in backend when needed.
  - Service status and `doctor` now expose whether a real `zktls.bundle` worker is configured.
  - Deterministic fixture tests now cover worker-backed `news.fetch` routing and replay-safe paid invocation flow.
  - A Rust workspace now exists under `workers/` with a deterministic `openfox-zktls-bundler` CLI worker implementation.
  - End-to-end paid `news.fetch` tests now exercise the real Rust worker binary rather than an inline JavaScript stub.

## Task 87 Breakdown

- Product mapping:
  - This task supports third-party verified-news, evidence, and proof-aware market products.
  - It upgrades the reusable verifier substrate, not a one-off application flow.
- Implementation direction:
  - Treat `proofverify.verify` as a Rust-first CLI worker backend.
  - Prefer Rust verifier implementations that can consume TLSNotary-style
    attestation bundles and related verifier material as the first real backend
    class.
  - Do not implement the real proof verifier as a Node.js/TypeScript
    cryptographic engine.
  - Use TypeScript only for request shaping, worker invocation, result mapping,
    persistence, and operator surfaces.
  - Support multiple verifier classes behind one bounded CLI contract rather
    than introducing a second public protocol.
- [x] Define canonical verifier backend classes for structural verification, bundle integrity verification, and cryptographic proof verification.
- [x] Add a Rust-first CLI worker adapter behind the existing `proof.verify` provider shell.
- [x] Persist verifier class, verifier-material reference, verdict reason, and bound subject hashes in durable verification records.
- [x] Surface verifier readiness, unsupported proof classes, and degraded verifier state through service status, `doctor`, and operator APIs.
- Progress already landed:
  - The `proofverify.verify` CLI worker contract is defined in `OpenFox-CLI-Worker-Contracts-v0.md`.
  - The `proof.verify` skill path can now invoke a configured bounded CLI worker and fall back to the current built-in verifier when needed.
  - Service status and `doctor` now expose whether a real `proofverify.verify` worker is configured.
  - Deterministic fixture tests now cover worker-backed `proof.verify` routing over paid provider invocation.
  - A Rust workspace now exists under `workers/` with a deterministic `openfox-proof-verifier` CLI worker implementation.
  - End-to-end paid `proof.verify` tests now exercise the real Rust worker binary rather than an inline JavaScript stub.
- [x] Add requester-side summaries that distinguish fallback verification from real proof verification.
- [x] Add end-to-end tests for invalid, inconclusive, and valid proof bundle paths.

## Task 88 Breakdown

- Product mapping:
  - This task supports threshold-backed verified-news, evidence markets, and bounded oracle products.
  - It provides the reusable coordinator-side committee layer that third-party products can compose.
- [x] Define canonical committee assignment, vote, tally, and aggregate schemas for evidence and oracle committee workflows.
- [x] Add deterministic coordinator-side `M-of-N` tallying with bounded member assignment, quorum, and payout rules.
- [x] Persist committee runs, member votes, quorum state, and payout allocations in durable local state.
- [x] Add coordinator CLI surfaces for committee list/get/tally/payout inspection.
- [x] Connect committee outcomes into owner reports, operator summaries, and market result surfaces.
- [x] Add end-to-end tests for partial quorum, disagreement, failed members, and bounded re-run behavior.

## Task 89 Breakdown

- Product mapping:
  - This task supports public proof-backed feeds such as `news.get`, evidence retrieval products, and reusable verification lanes for external builders.
  - It completes the public proof and verification substrate rather than a single product.
- [x] Define canonical public proof bundle classes for zkTLS bundles, committee votes, aggregates, verifier receipts, and proof material references.
- [x] Extend storage and artifact policy packs for proof-oriented replication, durability, and retention rules.
- [x] Add public search and index surfaces for proof and verification artifacts.
- [x] Add reusable `tosdk` helpers and example packs for proof retrieval and verification consumption.
- [x] Add operator packs for proof-market and verification-market public deployments.
- [x] Add end-to-end packaged deployment validation for proof capture, verification, storage, and retrieval on a public multi-node topology.
