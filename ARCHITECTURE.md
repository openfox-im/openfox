# Architecture

OpenFox is a local-first, TOS-native agent runtime. It keeps a persistent agent process running, holds a native TOS wallet, discovers and exposes agent capabilities, executes tasks, accepts payments through TOS `x402`, and publishes settlement artifacts back onto TOS.

## Table of Contents

- [System Overview](#system-overview)
- [Current Product Model](#current-product-model)
- [Boot and Runtime Lifecycle](#boot-and-runtime-lifecycle)
- [CLI and Operator Surface](#cli-and-operator-surface)
- [Directory Structure](#directory-structure)
- [Core Execution Path](#core-execution-path)
- [Inference and Provider Model](#inference-and-provider-model)
- [Wallet and TOS Integration](#wallet-and-tos-integration)
- [Agent Discovery and Gateway](#agent-discovery-and-gateway)
- [Paid Service Surfaces](#paid-service-surfaces)
- [Task Marketplace and Opportunity Scout](#task-marketplace-and-opportunity-scout)
- [Settlement Architecture](#settlement-architecture)
- [Heartbeat and Managed Service Model](#heartbeat-and-managed-service-model)
- [Persistence and Schema](#persistence-and-schema)
- [Configuration Model](#configuration-model)
- [Security Model](#security-model)
- [Supporting Modules](#supporting-modules)
- [Testing and Build](#testing-and-build)
- [Module Dependency Graph](#module-dependency-graph)

---

## System Overview

```text
                         Operator / User
                                |
                     configure, run, supervise, earn
                                |
                                v
+------------------------------------------------------------------+
|                    OpenFox Agent Runtime                         |
|                                                                  |
|  Core loop                                                       |
|  - CLI bootstrap                                                 |
|  - agent loop                                                    |
|  - heartbeat daemon                                              |
|  - persistent SQLite state                                       |
|                                                                  |
|  Runtime capabilities                                            |
|  - tools, policy engine, spend tracking                          |
|  - memory and orchestration modules                              |
|  - local-first inference provider routing                        |
|                                                                  |
|  TOS-native capabilities                                         |
|  - wallet / address / signing / transfers                        |
|  - TOS x402 payments                                             |
|  - settlement receipt publication                                |
|  - contract callback dispatch                                    |
|                                                                  |
|  Network and business surfaces                                   |
|  - Agent Discovery cards and clients                             |
|  - Agent Gateway server and provider sessions                    |
|  - faucet / observation / oracle providers                       |
|  - bounty host / solver / scout                                  |
+------------------------------------------------------------------+
           |                         |                         |
           | discover / be found     | provide paid services   | execute tasks
           v                         v                         v
+------------------+      +------------------+      +------------------+
| Other Agents     |      | Users / Clients  |      | Tasks / Jobs     |
| / Providers      |      | / Sponsors       |      | / Opportunities  |
+------------------+      +------------------+      +------------------+
           \                         |                         /
            \________________________|________________________/
                                     |
                                     v
+------------------------------------------------------------------+
|                           TOS Network                             |
|  - wallet balances and nonces                                     |
|  - native transaction submission                                  |
|  - x402 payment verification                                      |
|  - receipt and settlement anchors                                 |
|  - future contract-native task/query settlement                   |
+------------------------------------------------------------------+
```

The core architectural point is:

- `TOS` is the payment and settlement layer.
- `OpenFox` is the agent execution and service layer.
- `Agent Discovery`, `Gateway`, `bounty`, `observation`, `oracle`, and `settlement` are the first revenue-generating surfaces built on top of that runtime.

---

## Current Product Model

The current codebase is organized around these product assumptions:

- OpenFox runs locally by default.
- OpenFox can use `OpenAI`, `Anthropic`, and `Ollama`.
- OpenFox owns a native `TOS` wallet and can query balances, sign native transfers, and submit TOS payments.
- OpenFox can expose paid or sponsored capabilities through Agent Discovery and Agent Gateway.
- OpenFox can host tasks, solve tasks, discover opportunities, and publish settlement receipts.
- OpenFox can run continuously as a CLI process or as a managed Linux user service.

---

## Boot and Runtime Lifecycle

The main runtime path lives in [`src/index.ts`](/home/tomi/openfox/src/index.ts).

High-level boot sequence:

```text
START
  |
  v
Load config from ~/.openfox/openfox.json
  |
  +--> if missing: run interactive setup wizard
  |
  v
Load wallet and derive TOS address
  |
  v
Require at least one inference provider
  |
  v
Open SQLite database and initialize schema/migrations
  |
  v
Build identity, runtime client, inference client, policy engine, spend tracker
  |
  v
Optionally start:
  - Agent Discovery card publishing
  - faucet / observation / oracle servers
  - Agent Gateway server
  - gateway provider sessions
  - bounty host or solver automation
  - settlement publisher / callback dispatcher
  |
  v
Start heartbeat daemon
  |
  v
Main run loop:
  - run agent loop
  - if sleeping, wait for wake events
  - if dead, heartbeat keeps monitoring
  - on error, back off and retry
```

The runtime alternates between:

- `running`: the agent loop is actively reasoning and calling tools.
- `sleeping`: the heartbeat keeps ticking and may queue wake events.
- `dead`: the loop stays down, but heartbeat tasks still monitor recovery conditions.

Wake requests are persisted in the database and consumed atomically, so the foreground loop and background scheduler coordinate through durable state instead of ad hoc process memory.

---

## CLI and Operator Surface

OpenFox is both a runtime and an operator-facing CLI.

Primary top-level surfaces:

- `openfox --setup`, `--configure`, `--pick-model`, `--run`
- `openfox status`
- `openfox skills ...`
- `openfox heartbeat ...`
- `openfox cron ...`
- `openfox service ...`
- `openfox gateway ...`
- `openfox health`
- `openfox doctor`
- `openfox models status`
- `openfox onboard`
- `openfox wallet ...`
- `openfox logs`
- `openfox bounty ...`
- `openfox settlement ...`
- `openfox scout ...`

This means the architecture is not just "a library plus a loop." It includes explicit operator UX for lifecycle management, diagnostics, wallet funding, services, settlement inspection, and automation control.

---

## Directory Structure

The current source tree is organized around the active OpenFox runtime and service surfaces.

```text
src/
  index.ts                  Main entry point and CLI router
  config.ts                 openfox.json load/merge/compat handling
  types.ts                  Shared runtime types and defaults

  agent/                    Main think/act/observe loop
    loop.ts
    tools.ts
    system-prompt.ts
    context.ts
    policy-engine.ts
    spend-tracker.ts
    injection-defense.ts
    policy-rules/

  agent-discovery/          Agent card publishing, lookup, paid provider servers
    card.ts
    client.ts
    faucet-server.ts
    observation-server.ts
    oracle-server.ts
    security.ts
    types.ts

  agent-gateway/            Relay gateway server and provider sessions
    server.ts
    client.ts
    publish.ts
    bootnodes.ts
    auth.ts
    e2e.ts
    types.ts

  bounty/                   Task marketplace host/solver engine
    engine.ts
    automation.ts
    client.ts
    http.ts
    payout.ts
    evaluate.ts
    skills/

  commands/                 Focused command handlers
    onboard.ts
    wallet.ts

  doctor/                   Health and diagnostic reports
    report.ts

  heartbeat/                Always-on scheduler and wake logic
    daemon.ts
    scheduler.ts
    tasks.ts
    operator.ts
    config.ts
    tick-context.ts

  identity/                 Wallet file and provisioning helpers
    wallet.ts
    provision.ts

  inference/                Provider registry, routing, budgets
    registry.ts
    router.ts
    budget.ts
    provider-registry.ts
    inference-client.ts
    types.ts

  memory/                   Working, episodic, semantic, procedural memory
  models/                   Operator-facing model/provider status
  observability/            Logging, metrics, alerts
  ollama/                   Ollama model discovery
  opportunity/              Scout and ranking of earning surfaces
  orchestration/            Multi-agent/task-planning runtime helpers
  replication/              Child-agent spawning and lifecycle

  runtime/                  Shared execution, transport, and inference client utilities
    client.ts
    inference.ts
    http-client.ts
    credits.ts
    x402.ts

  self-mod/                 Safe code edits, repo sync, tool installs
  service/                  Managed service lifecycle and service health UX
  settlement/               Receipt publishing and callback dispatch
  setup/                    Interactive setup/configure/model-pick flows
  skills/                   Skill loading and installation
  social/                   Optional social relay transport
  soul/                     SOUL.md model and reflection
  state/                    SQLite schema and database wrapper
  survival/                 Low-compute and funding heuristics
  tos/                      Native TOS address, client, errors, x402
  wallet/                   Wallet operator flows
  __tests__/                Unit and integration tests
```

Mainline modules for the current product are:

- `agent`
- `heartbeat`
- `tos`
- `wallet`
- `agent-discovery`
- `agent-gateway`
- `bounty`
- `opportunity`
- `settlement`
- `service`
- `state`

---

## Core Execution Path

The central execution engine is still the agent loop in [`src/agent/loop.ts`](/home/tomi/openfox/src/agent/loop.ts).

The loop is responsible for:

- building the system prompt and wake context
- loading built-in tools and installed tools
- retrieving memory under a token budget
- choosing an inference path
- executing approved tool calls
- persisting turns and tool results
- ingesting memory from completed work
- deciding when to continue, sleep, or fail

Conceptually the runtime still follows:

```text
Think -> Act -> Observe -> Persist -> Repeat
```

Supporting components:

- `agent/tools.ts`: built-in tool definitions and execution
- `agent/policy-engine.ts`: centralized rule evaluation before sensitive actions
- `agent/spend-tracker.ts`: cost and spend tracking
- `agent/injection-defense.ts`: prompt/tool-input sanitization
- `memory/*`: retrieval, compression, context management, and ingestion

The core loop is therefore no longer just "chat with tools." It is a persistent, stateful execution engine with durable history, scheduling, and task-specific business surfaces attached around it.

---

## Inference and Provider Model

OpenFox is local-first in startup, but provider-flexible in execution.

### Primary providers

The current code supports these primary providers:

- `OpenAI`
- `Anthropic`
- `Ollama`

Provider readiness is surfaced through [`src/models/status.ts`](/home/tomi/openfox/src/models/status.ts).

### Routing layers

There are two inference layers in the codebase:

1. `src/runtime/inference.ts`
   - the main OpenAI-compatible inference client used by the runtime
   - routes requests to configured providers used by the main loop

2. `src/inference/*`
   - model registry
   - provider registry
   - routing and budget tracking
   - local orchestration support

This split exists because OpenFox has both:

- a stable runtime-facing inference client used by the main loop
- a newer provider-aware routing stack used for orchestration and model metadata

### Local-first boundary

The important architectural boundary is:

- OpenFox does not require a remote control plane to start.
- OpenFox starts from local config, local wallet state, and a configured inference provider.
- The `src/runtime/*` layer provides shared transport, execution, credit, and inference utilities used by the rest of the runtime.

---

## Wallet and TOS Integration

TOS integration is now a first-class subsystem, not a sidecar.

Main modules:

- [`src/tos/address.ts`](/home/tomi/openfox/src/tos/address.ts)
- [`src/tos/client.ts`](/home/tomi/openfox/src/tos/client.ts)
- [`src/tos/x402.ts`](/home/tomi/openfox/src/tos/x402.ts)
- [`src/wallet/operator.ts`](/home/tomi/openfox/src/wallet/operator.ts)
- [`src/commands/wallet.ts`](/home/tomi/openfox/src/commands/wallet.ts)

Current wallet capabilities:

- derive native TOS addresses from the local private key
- query chain ID, balance, nonce, account profile, and signer metadata
- send native TOS transfers
- fund from local devnet accounts
- request testnet funding from a configured faucet or Agent Discovery faucet
- bootstrap signer metadata for non-`secp256k1` accounts

The wallet command surface is explicit:

- `openfox wallet status`
- `openfox wallet fund local`
- `openfox wallet fund testnet`
- `openfox wallet bootstrap-signer`

Native TOS payment handling also powers the service layer:

- x402 payment requirements
- payment verification
- payment submission
- result receipts and settlement anchors

---

## Agent Discovery and Gateway

Discovery and reachability are now core architecture, not optional add-ons.

### Agent Discovery

The Agent Discovery subsystem handles:

- local card generation and publishing
- capability advertisement
- provider search and trust filtering
- faucet, observation, and oracle provider invocation
- request nonce and replay protection helpers

Relevant files:

- [`src/agent-discovery/card.ts`](/home/tomi/openfox/src/agent-discovery/card.ts)
- [`src/agent-discovery/client.ts`](/home/tomi/openfox/src/agent-discovery/client.ts)
- [`src/agent-discovery/types.ts`](/home/tomi/openfox/src/agent-discovery/types.ts)
- [`src/agent-discovery/security.ts`](/home/tomi/openfox/src/agent-discovery/security.ts)

### Agent Gateway

The Agent Gateway subsystem solves the "provider behind NAT/private IP" problem.

It provides:

- a gateway server that exposes public relay URLs
- provider-side outbound WebSocket sessions
- bootnode and signed bootnode-list support
- provider route publication into Agent Discovery cards
- optional payment-aware relay modes

Relevant files:

- [`src/agent-gateway/server.ts`](/home/tomi/openfox/src/agent-gateway/server.ts)
- [`src/agent-gateway/client.ts`](/home/tomi/openfox/src/agent-gateway/client.ts)
- [`src/agent-gateway/publish.ts`](/home/tomi/openfox/src/agent-gateway/publish.ts)
- [`src/agent-gateway/bootnodes.ts`](/home/tomi/openfox/src/agent-gateway/bootnodes.ts)

At runtime, `src/index.ts` coordinates these systems so that:

- local provider servers start first
- gateway provider sessions attach to those local routes
- the current relay URL set is republished into the Agent Discovery card

That integration is what makes private provider nodes externally reachable without changing the core service logic.

---

## Paid Service Surfaces

The service layer now includes real business handlers rather than only demo endpoints.

### Faucet provider

`src/agent-discovery/faucet-server.ts`

Purpose:

- sponsor testnet top-ups
- expose `sponsor.topup.testnet`

### Observation provider

`src/agent-discovery/observation-server.ts`

Purpose:

- expose paid `observation.once`
- fetch a target URL
- persist the observation result
- bind duplicate requests to a single stored job
- require TOS x402 payment before work
- optionally publish settlement and dispatch a settlement callback

Externally visible surface:

- provider endpoint
- `GET /jobs/:id` for persisted lookup

### Oracle provider

`src/agent-discovery/oracle-server.ts`

Purpose:

- expose paid `oracle.resolve`
- quote and resolve bounded oracle-style questions
- reuse the local inference path for resolution
- persist a canonical result
- publish settlement and optional callback

Externally visible surface:

- `POST /oracle/quote`
- `POST /oracle/resolve`
- `GET /oracle/result/:id`

These service modules are where TOS-native payments, the model layer, database persistence, and settlement publishing come together into user-facing revenue surfaces.

---

## Task Marketplace and Opportunity Scout

The marketplace path lives under `src/bounty/*` and `src/opportunity/*`.

### Bounty engine

The bounty engine supports four task kinds:

- `question`
- `translation`
- `social_proof`
- `problem_solving`

Core responsibilities:

- open bounties
- store submissions
- evaluate submissions with the local model path
- enforce submission/payout policy
- pay winners natively on TOS
- publish settlement receipts
- optionally dispatch contract callbacks after settlement

Key files:

- [`src/bounty/engine.ts`](/home/tomi/openfox/src/bounty/engine.ts)
- [`src/bounty/http.ts`](/home/tomi/openfox/src/bounty/http.ts)
- [`src/bounty/automation.ts`](/home/tomi/openfox/src/bounty/automation.ts)
- [`src/bounty/payout.ts`](/home/tomi/openfox/src/bounty/payout.ts)

### Roles

OpenFox can run as:

- bounty host
- bounty solver
- opportunity scout

The main runtime boot path starts host or solver automation based on `config.bounty.role`.

### Opportunity scout

`src/opportunity/scout.ts` collects and ranks remote opportunities from:

- discovery capabilities
- remote task base URLs
- provider surfaces such as faucet, observation, and oracle

This turns OpenFox from a passive runtime into an earning-oriented runtime that can search for profitable work.

---

## Settlement Architecture

Settlement is now its own subsystem and one of the clearest signs of the current framework shape.

Main files:

- [`src/settlement/publisher.ts`](/home/tomi/openfox/src/settlement/publisher.ts)
- [`src/settlement/callbacks.ts`](/home/tomi/openfox/src/settlement/callbacks.ts)

### Settlement publisher

The publisher:

- builds a canonical settlement receipt
- hashes the receipt
- sends a native TOS transaction carrying the canonical receipt bytes
- stores the resulting settlement record in SQLite
- keeps publication idempotent per `(kind, subject_id)`

Supported settlement kinds:

- `bounty`
- `observation`
- `oracle`

### Settlement callbacks

The callback dispatcher:

- derives a callback payload from the canonical receipt or receipt hash
- sends a native TOS transaction to a configured contract address
- tracks attempts, status, receipts, and retry deadlines
- retries pending callbacks in batch

### Heartbeat integration

The heartbeat task `retry_settlement_callbacks` is what closes the loop operationally:

- foreground business logic publishes or queues settlement work
- background heartbeat retries contract-bound callbacks until confirmed or failed

This is the current bridge between off-chain service execution and contract-bound settlement integration.

---

## Heartbeat and Managed Service Model

OpenFox is intended to remain alive even when the operator is not at the keyboard.

### Heartbeat

Key files:

- [`src/heartbeat/daemon.ts`](/home/tomi/openfox/src/heartbeat/daemon.ts)
- [`src/heartbeat/scheduler.ts`](/home/tomi/openfox/src/heartbeat/scheduler.ts)
- [`src/heartbeat/tasks.ts`](/home/tomi/openfox/src/heartbeat/tasks.ts)
- [`src/heartbeat/operator.ts`](/home/tomi/openfox/src/heartbeat/operator.ts)

Heartbeat responsibilities:

- durable cron-style scheduling
- wake-event production
- wallet/credit checks
- social inbox polling
- metrics snapshots and pruning
- settlement callback retry
- operator-triggered runs and status reports

### Managed service

The service layer in `src/service/*` adds Linux user-systemd management:

- install
- uninstall
- start
- stop
- restart
- service log location
- service role/status/health inspection

This gives OpenFox a productized "always-on agent" deployment path rather than assuming an operator will keep a terminal open forever.

---

## Persistence and Schema

Persistence is centered on SQLite through:

- [`src/state/schema.ts`](/home/tomi/openfox/src/state/schema.ts)
- [`src/state/database.ts`](/home/tomi/openfox/src/state/database.ts)

Current schema version: `15`

Important tables include:

- `identity`
- `turns`
- `tool_calls`
- `heartbeat_entries`
- `heartbeat_schedule`
- `heartbeat_history`
- `wake_events`
- `transactions`
- `installed_tools`
- `modifications`
- `kv`
- `skills`
- `policy_decisions`
- `spend_tracking`
- `children`
- `reputation`
- `inbox_messages`
- `bounties`
- `bounty_submissions`
- `bounty_results`
- `soul_history`
- `metric_snapshots`
- `settlement_receipts`
- `settlement_callbacks`

This tells you what the current runtime cares about durably:

- agent state
- tools and turns
- scheduling
- skills
- task marketplace state
- settlement publication and retries
- child-agent lineage
- inbox/reputation/social surfaces

OpenFox uses the database as the durable coordination layer between the CLI, the foreground loop, provider servers, and the heartbeat daemon.

---

## Configuration Model

OpenFox loads configuration from `~/.openfox/openfox.json` through [`src/config.ts`](/home/tomi/openfox/src/config.ts).

Important config areas:

- identity and wallet
- inference provider keys and selected model
- `rpcUrl` and `chainId`
- `agentDiscovery`
- `bounty`
- `opportunityScout`
- `settlement`
- `treasuryPolicy`
- heartbeat and database paths

The live product model is the OpenFox-native config shape defined in [`src/types.ts`](/home/tomi/openfox/src/types.ts).

---

## Security Model

The security posture is layered rather than concentrated in one module.

### Execution controls

- `agent/policy-engine.ts` applies policy rules before sensitive operations.
- `agent/policy-rules/*` covers authority, command safety, finance, path protection, validation, and rate limits.
- `agent/injection-defense.ts` sanitizes untrusted input before it reaches tools or prompts.

### Payment and network controls

- `agent-discovery/security.ts` handles replay checks and request expiry checks for provider requests.
- TOS `x402` verification is enforced before paid service execution.
- private-target restrictions exist for observation requests.

### Runtime boundary controls

- `runtime/client.ts` refuses silent local fallback on remote auth failures for protected remote operations.
- managed service installation is limited to Linux user-systemd.
- wallet operations surface explicit, operator-readable errors.

### Marketplace controls

- bounty policy enforces submission limits, proof URL allowlists, solver cooldowns, and max auto-pay windows.
- settlement callbacks persist retry state rather than retrying blindly in memory.

---

## Supporting Modules

Several modules support the runtime but are not the main architectural spine of the current product.

### Secondary but active

- `memory/*`: still part of the main loop and increasingly important
- `observability/*`: logging, metrics, alerts
- `skills/*`: critical to agent extensibility
- `wallet/*`: active operator surface

### Active but not the main product headline

- `orchestration/*`: plan mode, worker pools, task graph, local workers
- `replication/*`: child-agent spawning and lifecycle
- `social/*`: social relay client and signed messaging
- `soul/*`: SOUL.md parsing and reflection
- `self-mod/*`: code modification and repo sync helpers

### Infrastructure and support layers

- `runtime/*`: shared transport, execution, credit, and inference helpers
- `config.ts`: config normalization and default merging

The right mental model is:

- the TOS-native earning/runtime path is the primary architecture
- these other modules extend or support it, but do not define the main product direction by themselves

---

## Testing and Build

Build and test are straightforward:

- `pnpm build`
- `pnpm test`
- `pnpm typecheck`

The test suite covers:

- TOS client and x402 flows
- agent discovery and gateway servers
- bounty and settlement logic
- heartbeat and service operator surfaces
- policy and injection safety
- wallet and onboarding flows

This is important architecturally because many of the current subsystems are integration-heavy; correctness depends on how modules compose, not only on local function logic.

---

## Module Dependency Graph

```text
index.ts
  |
  +--> config.ts
  +--> identity/wallet.ts
  +--> state/database.ts
  +--> runtime/client.ts
  +--> runtime/inference.ts
  +--> agent/loop.ts
  +--> heartbeat/*
  +--> service/*
  +--> skills/*
  +--> wallet/*
  +--> tos/*
  +--> agent-discovery/*
  +--> agent-gateway/*
  +--> bounty/*
  +--> opportunity/*
  +--> settlement/*
  +--> doctor/report.ts
  +--> models/status.ts

agent/loop.ts
  |
  +--> agent/tools.ts
  +--> agent/policy-engine.ts
  +--> inference/*
  +--> memory/*
  +--> runtime/*
  +--> state/database.ts
  +--> orchestration/*

agent-discovery/* and bounty/*
  |
  +--> tos/*
  +--> settlement/*
  +--> state/database.ts
  +--> inference/* or runtime/inference.ts

heartbeat/tasks.ts
  |
  +--> runtime/credits.ts
  +--> observability/*
  +--> settlement/callbacks.ts
  +--> state/database.ts
```

The architectural center of gravity is now:

```text
CLI + Agent Loop + Heartbeat + SQLite
            +
   TOS Wallet + x402 + Settlement
            +
 Discovery + Gateway + Bounty + Paid Services
```

That is the current OpenFox framework structure.
