# OpenFox Operator-Box Design

This document turns the current `operator-box` discussion into a formal design
target.

OpenFox itself is not a chat tool. Its north star is to become an agent
platform on `TOS.network` that can:

- discover opportunities
- take work
- get paid
- issue rewards
- call other agents
- complete proof and settlement flows

`operator-box` exists to operate that platform safely at multi-node scale. It
is a supporting control plane, not the product center of gravity.

It defines:

- what `operator-box` is today
- what is still missing before it becomes a true multi-node operator surface
- what financial reporting must exist if customers deploy OpenFox to earn
  revenue
- which control-plane features should be automated, and which should remain
  approval-gated

This document complements:

- `docs/OpenFox-Fleet-Operator-Guide.md`
- `docs/OpenFox-Dashboard-Guide.md`
- `docs/OpenFox-Six-Node-Network-Guide.md`
- `docs/ROADMAP.md`

## 1. Problem Statement

The current OpenFox fleet surface is strong at remote observation and limited
batch repair, but it is not yet a full operator control plane.

That gap matters because OpenFox is trying to run a revenue-generating agent
network, not just keep a few background processes alive.

Today an operator can:

- expose authenticated node-local operator APIs
- audit a fleet through `openfox fleet ...`
- export dashboard snapshots
- trigger remote repair for storage and artifact nodes

That is enough to inspect a small public fleet that provides gateway, storage,
artifact, signer, paymaster, and related agent-service roles.

It is not enough to operate a revenue-generating OpenFox network with minimal
manual intervention while that network is discovering opportunities, taking
jobs, paying or hiring other agents, and settling completed work.

Customers deploying OpenFox do not just want to know whether nodes are alive.
They need to know:

- which nodes are earning money
- which nodes are losing money
- which roles are profitable
- which queues are stuck and blocking revenue recognition
- which low-risk repairs can run automatically
- which high-risk actions still require human approval

## 2. Current Baseline

The current operator surface already provides:

- fleet-level `lint`, `status`, `health`, `doctor`, `service`, `gateway`,
  `storage`, `lease-health`, `artifacts`, `signer`, `paymaster`, and
  `providers`
- dashboard exports for JSON, HTML, and bundled audit artifacts
- remote repair for `storage` and `artifacts`

The current runtime already stores financial building blocks locally:

- wallet identity and local wallet status
- `x402` payment records
- settlement receipts and callbacks
- market bindings and callbacks
- spend tracking
- inference cost records
- on-chain transaction records
- expected and actual revenue or cost fields in higher-level task state

So the missing piece is not raw telemetry. The missing piece is turning those
node-local records into an operator-grade control plane and finance surface for
the actual OpenFox business loop:

- opportunity discovery
- job intake
- payments and rewards
- agent-to-agent execution
- proof publication
- settlement

## 3. Target Outcome

`operator-box` should become a lightweight operator control plane for a small
OpenFox agent network on `TOS.network`.

It should provide three layers.

### Layer A: Observability

This is the current foundation.

The operator should be able to answer:

- which nodes are reachable
- which services are degraded
- which provider roles are accumulating failure debt
- which storage leases, artifact queues, signer queues, or paymaster queues are
  behind

### Layer B: FinOps

This is the missing business layer.

The operator should be able to answer:

- how much each node earned today, over 7 days, and over 30 days
- how much each node spent in the same windows
- which roles produce positive or negative gross margin
- which payments are confirmed, pending, failed, or recoverable
- which nodes are funded enough to keep operating
- which customers, capabilities, and workloads are worth continuing

### Layer C: Autopilot

This is the missing control layer.

The operator should be able to declare low-risk automated actions while keeping
high-risk actions approval-gated.

Examples of low-risk actions:

- retrying eligible queues
- renewing due storage work
- catching up artifact verification
- quarantining obviously unhealthy providers

Examples of high-risk actions:

- moving treasury funds
- widening signer or paymaster policy
- changing spend caps
- restarting or draining critical public nodes during active traffic
- rolling out new runtime versions

## 4. Main Gaps

### 4.1 Wallet and Treasury Visibility

The current fleet view does not expose a dedicated wallet or treasury snapshot
per node.

Missing operator questions:

- current wallet balance by node
- reserved balance versus free operating balance
- recent inbound and outbound transfers
- pending liabilities and pending receivables
- runway based on recent burn rate

### 4.2 Revenue and Cost Reporting

The current fleet dashboard does not expose a normalized financial report.

Missing operator questions:

- revenue by node
- cost by node
- net profit by node
- revenue by role
- revenue by capability
- revenue by customer or counterparty
- revenue and cost per request, task, lease, artifact, or delegated execution

### 4.3 Queue and Recovery Control

The current fleet surface shows health, but it does not give a general
mechanism for remote queue recovery.

Missing operator actions:

- retry failed or pending `x402` payments
- retry settlement callbacks
- retry market callbacks
- retry signer submissions
- retry paymaster authorizations
- pause a degraded node
- resume a drained node
- drain a node before maintenance

### 4.4 Config and Policy Rollout

The current fleet surface does not provide centralized rollout of safe config
changes.

Missing operator actions:

- rotate operator auth tokens
- rotate provider secrets
- distribute policy updates
- push spend-cap changes
- roll out approved runtime settings to multiple nodes

### 4.5 Automation and Incident Workflow

The current fleet surface does not yet include a policy engine for
condition-based automation.

Missing automation patterns:

- if lease health becomes critical, run a bounded maintenance batch
- if signer failures exceed a threshold, quarantine the provider
- if paymaster balance falls below a threshold, raise an alert before service
  denial
- if a node's gross margin stays negative for N days, mark it for operator
  review

## 5. Financial Reporting Requirements

OpenFox customers deploy nodes to earn revenue. That means every node in a
fleet needs a financial identity, not just a process identity.

Each node should expose a standard financial report.

Minimum required fields:

- node name and role
- wallet address
- current wallet balance
- reserved balance
- available operating balance
- revenue today, 7 days, and 30 days
- cost today, 7 days, and 30 days
- net profit today, 7 days, and 30 days
- pending receivables
- pending payables
- failed but retryable receivables
- failed but retryable payables
- top capabilities by revenue
- top customers by revenue
- top cost categories
- recent on-chain spend and recent off-chain spend

### Role-Specific Profit Views

The same report format should exist across all nodes, but each role needs
role-aware breakout lines.

`gateway` nodes should report:

- ingress request volume
- gateway-session and gateway-request payment volume
- relay-related costs

`host` and `solver` nodes should report:

- task revenue
- model or inference costs
- contractor payments
- task-level margin

`storage` nodes should report:

- lease revenue
- renewal workload
- replication and audit costs
- under-replicated or overdue liabilities

`artifact` nodes should report:

- verification revenue
- anchoring costs
- publication backlog and pending revenue recognition

`signer` nodes should report:

- quote revenue
- execution revenue
- failed or reversed submissions
- bounded liability tied to delegated executions

`paymaster` nodes should report:

- quote revenue
- sponsored execution revenue
- gas expenditure
- funding runway
- signer-parity and authorization backlog

### Attribution Rules

The finance surface should attribute revenue and cost at more than one level.

Required attribution dimensions:

- node
- role
- capability
- customer or requester
- provider or counterparty
- request key
- task or subject identifier
- settlement or callback status

This makes it possible to answer not only "did the fleet make money" but also
"which service line actually works."

## 6. Proposed Operator Surfaces

The recommended new surfaces are:

- `GET /operator/wallet/status`
- `GET /operator/finance/status`
- `GET /operator/payments/status`
- `GET /operator/settlement/status`
- `GET /operator/market/status`
- `POST /operator/control/pause`
- `POST /operator/control/resume`
- `POST /operator/control/drain`
- `POST /operator/control/retry/payments`
- `POST /operator/control/retry/settlement`
- `POST /operator/control/retry/market`
- `POST /operator/control/retry/signer`
- `POST /operator/control/retry/paymaster`

The corresponding CLI surfaces should be:

- `openfox fleet wallet --manifest <path>`
- `openfox fleet finance --manifest <path>`
- `openfox fleet payments --manifest <path>`
- `openfox fleet settlement --manifest <path>`
- `openfox fleet market --manifest <path>`
- `openfox fleet control pause --manifest <path> --node <name>`
- `openfox fleet control resume --manifest <path> --node <name>`
- `openfox fleet control drain --manifest <path> --node <name>`
- `openfox fleet retry <payments|settlement|market|signer|paymaster> --manifest <path>`

The dashboard layer should grow to include:

- wallet balance panels
- revenue, cost, and net-profit panels
- pending receivable and payable panels
- negative-margin detection
- funding runway warnings
- queue recovery recommendations

## 7. Automation Model

The automation model should stay conservative.

### Safe To Automate

- storage renewals within existing policy
- artifact verification catch-up
- retries of idempotent payment or callback work
- provider quarantine when hard health thresholds fail
- dashboard and finance bundle exports

### Approval-Gated

- treasury transfers
- signer and paymaster policy expansion
- new spend-cap ceilings
- global config rollout
- runtime upgrades and rollbacks
- draining public gateways during active traffic

This keeps `operator-box` useful without turning it into an unsafe blind
orchestrator.

## 8. Implementation Strategy

Build this in three stages.

### Stage 1: Per-Node Finance Snapshots

Goal:

- expose wallet and finance reports on each node

First implementation slice:

- add node-local finance projection helpers
- add operator wallet and finance endpoints
- add single-node CLI report surfaces
- add fleet aggregation for wallet and finance snapshots

### Stage 2: Fleet FinOps

Goal:

- turn per-node reports into fleet-wide business reporting

First implementation slice:

- aggregate node P&L across the fleet
- add node, role, capability, and customer breakdowns
- add finance sections to dashboard JSON and HTML exports
- surface pending receivables, liabilities, and retryable revenue

### Stage 3: Controlled Autopilot

Goal:

- automate low-risk maintenance without removing operator control

First implementation slice:

- add authenticated mutation endpoints for bounded control actions
- add fleet retry and pause or drain commands
- add approval-gated policies for high-risk actions
- record all operator-box actions as auditable control events

## 9. Non-Goals

`operator-box` should not become:

- a full Kubernetes replacement
- an unrestricted remote shell
- a hidden custodial treasury manager
- a blind self-upgrading platform
- a dashboard that reports revenue without cost attribution

The point is not maximum automation. The point is bounded automation plus clear
economic visibility.

## 10. Summary

OpenFox already has the beginnings of a real multi-node operator surface.

To become a revenue-grade operator plane, it still needs:

- wallet and treasury visibility
- per-node and fleet-wide financial reporting
- queue and recovery control
- bounded remote control actions
- conservative autopilot rules with audit trails

That is the path from "fleet status tool" to "small agent-network control
plane."
