# OpenFox Six-Node Network Guide

This guide describes a practical small OpenFox network built from six runtime
nodes plus one optional operator machine.

The goal is not to maximize node count. The goal is to split roles cleanly
enough that:

- public ingress is isolated
- private providers can sit behind NAT
- storage and artifact work stay durable
- high-risk chain execution is bounded
- one operator can audit and maintain the whole network without manually
  logging into every node

This guide complements:

- `docs/OpenFox-Multi-Node-Deployment-Guide.md`
- `docs/OpenFox-Fleet-Operator-Guide.md`
- `docs/OpenFox-Operator-Box-Design.md`

## 1. Topology

Use the following six-node layout as a practical baseline:

```text
                         ┌──────────────────────────────┐
                         │        GTOS / TOS RPC        │
                         │ discovery / tx / receipts    │
                         └──────────────┬───────────────┘
                                        │
                    publish cards / settle / anchor / callbacks
                                        │
     ┌──────────────────────────────────┼──────────────────────────────────┐
     │                                  │                                  │
┌────▼─────┐                    ┌───────▼───────┐                   ┌──────▼──────┐
│gateway-1 │  public ingress    │host-1         │ hires / pays      │solver-1     │
│gateway   │<------------------>|requester/host |<----------------->|worker/solver│
└────┬─────┘  relay for NAT     └───────┬───────┘                   └──────┬──────┘
     │                                   │                                   │
     │                                   │ store outputs / evidence           │
     │                                   ▼                                   │
     │                           ┌───────────────┐    verify / anchor   ┌────▼──────┐
     │                           │storage-1      │<-------------------->|artifact-1 │
     │                           │storage prov.  │                      │artifacts   │
     │                           └───────────────┘                      └────┬──────┘
     │                                                                         │
     │                       bounded delegated / sponsored execution            │
     └──────────────────────────────────────────────->┌────────────────────────▼─────┐
                                                      │exec-1                        │
                                                      │signer + paymaster infra      │
                                                      └──────────────────────────────┘

Outside the hot path:
operator-box -> `openfox fleet ...` -> each node's `/operator/*`
```

In this topology:

- `gateway-1` is the public relay edge
- `host-1` is the task host and requester
- `solver-1` is the working agent
- `storage-1` stores durable bundles and lease-backed content
- `artifact-1` produces and verifies public artifacts and evidence bundles
- `exec-1` exposes bounded signer and paymaster services

`operator-box` is not part of the runtime hot path. It is the operator control
surface used to audit and maintain the fleet.

## 2. Role of Each Node

### `gateway-1`

The gateway node is the public ingress point.

Use it for:

- public HTTPS or relay exposure
- NAT traversal for private providers
- stable externally reachable endpoints for the rest of the network

Keep it focused. Do not overload the gateway with payout-heavy or storage-heavy
work unless the deployment is intentionally small.

### `host-1`

The host node is the business coordinator.

Use it for:

- accepting paid requests
- opening tasks or bounties
- selecting and hiring solvers or providers
- publishing settlement receipts and callback records
- tracking who did what and what still needs to be paid or confirmed

This is the node that most directly represents the service operator's intent.

### `solver-1`

The solver is the worker node.

Use it for:

- task execution
- model inference
- observation and data collection
- generating structured outputs for the host

This role should stay easy to replace. If a solver degrades, you want to swap
or restart it without disturbing gateway, storage, or settlement surfaces.

### `storage-1`

The storage provider is the durable data layer.

Use it for:

- storing immutable result bundles
- serving retrieval by `CID`
- renewal, audit, and replication upkeep

This node should have dedicated storage paths, disk monitoring, and operational
boundaries separate from the host payout wallet.

### `artifact-1`

The artifact node turns raw results into operator-usable public artifacts.

Use it for:

- oracle evidence capture
- public news bundles
- verification receipts
- anchoring and artifact publication

It sits between transient execution and durable public proof.

### `exec-1`

The execution infrastructure node exposes bounded chain execution services.

Use it for:

- signer provider surfaces
- paymaster provider surfaces
- delegated execution under strict policy
- sponsored execution under strict policy

In a six-node minimum layout, signer and paymaster can share one runtime. In a
larger or higher-risk deployment, split them into separate nodes.

## 3. How the Roles Cooperate

### Flow A: Public request to finished result

This is the main service path.

1. A requester reaches the network through `gateway-1` or directly reaches
   `host-1`.
2. `host-1` accepts the request, prices it, and decides whether it can fulfill
   it locally or should hire another agent.
3. `host-1` selects `solver-1` or another provider through discovery and local
   policy.
4. `solver-1` performs the work and returns a result package.
5. Large or durable outputs are pushed to `storage-1`.
6. Public evidence, verification, or canonical result bundles are processed by
   `artifact-1`.
7. `host-1` publishes settlement receipts, callback updates, and related chain
   records back to GTOS.

This keeps coordination on the host, computation on the solver, and durable
state on storage and artifact nodes.

### Flow B: Private providers behind a public gateway

This is the reachability path.

1. `gateway-1` advertises a public relay capability.
2. Private nodes such as `solver-1`, `storage-1`, or `artifact-1` establish
   outbound sessions to the gateway.
3. The gateway exposes public relay URLs.
4. Provider cards publish those relay URLs instead of private LAN addresses.
5. External clients reach the providers through the gateway, without those
   providers needing their own public IP addresses.

This is the standard way to keep provider nodes private while still making
their capabilities reachable.

### Flow C: Bounded chain execution

This is the high-risk execution path.

1. `host-1` or another node needs a chain-side action.
2. Instead of giving every node a broad hot wallet, the network uses `exec-1`.
3. `exec-1` exposes signer and paymaster services with explicit policy
   boundaries.
4. Execution is constrained by things such as target, value, selector, expiry,
   and whether sensitive system actions are allowed.
5. Resulting execution records and receipts can be linked back to storage,
   artifact, or settlement records.

This reduces the blast radius of autonomous behavior. Business nodes can ask
for execution without directly holding unconstrained signing power.

## 4. Why This Split Exists

This six-node shape is useful because it separates failure domains.

- A gateway outage does not have to corrupt storage.
- A storage issue does not have to stop task hosting.
- A solver bug does not need access to the main execution authority.
- Artifact catch-up work does not need to block public ingress.
- Signer and paymaster policy can be tightened without changing the business
  nodes.

It is a small but meaningful step away from "one giant agent process that does
everything" and toward "a small agent network with clear duties."

## 5. The `operator-box` Model

`operator-box` is the machine from which the operator manages the fleet.

It can be:

- a laptop with the `openfox` CLI installed
- a small VM used for operator workflows
- a dedicated OpenFox runtime if you deliberately want the operator surface to
  live on its own node

The important point is that it is not required to be on the request path. Its
job is to observe and steer the network, not to relay normal user traffic.

### What `operator-box` does

It keeps a `fleet.yml` manifest that lists the nodes, their roles, their
operator URLs, and their auth tokens.

From that one place, it can run:

- `openfox fleet lint`
- `openfox fleet status`
- `openfox fleet health`
- `openfox fleet doctor`
- `openfox fleet storage`
- `openfox fleet lease-health`
- `openfox fleet artifacts`
- `openfox fleet signer`
- `openfox fleet paymaster`
- `openfox fleet providers`
- `openfox fleet repair storage`
- `openfox fleet repair artifacts`

This gives the operator one view of the fleet instead of six separate SSH
sessions and six separate local status commands.

### What `operator-box` does not do

It is not a full cluster orchestrator.

It does not replace:

- each node's own heartbeat and scheduler
- local service supervision
- node-local wallet policy
- node-local storage or artifact upkeep loops

The current model is:

- each node runs itself locally
- each node exposes an authenticated operator API
- `operator-box` aggregates, audits, and triggers limited remote maintenance

That is closer to a lightweight control plane than to a full orchestration
system.

## 6. Operational Thought Process

When operating this network, think in two loops.

### Local loop

Each node handles its own ongoing work.

Examples:

- `host-1` tracks jobs and settlement callbacks
- `solver-1` runs work and returns outputs
- `storage-1` tracks leases, audits, and renewals
- `artifact-1` verifies and anchors bundles
- `exec-1` enforces signer or paymaster policy on submissions

### Fleet loop

The operator checks the network as a whole.

Examples:

- which nodes are down or misconfigured
- which storage leases are expiring
- which artifact queues are behind
- which signer or paymaster requests are pending or failing
- which providers are accumulating weak reputation signals

This separation is important. The fleet loop is about network health. The local
loop is about role-specific execution.

## 7. Recommended Deployment Boundaries

For a six-node deployment:

- keep one state directory per node
- keep one wallet boundary per role
- keep `gateway-1` public, but keep most providers private behind it when
  possible
- keep storage data paths separate from host runtime state
- keep signer and paymaster authority off the business nodes

If the network grows:

- split `exec-1` into separate signer and paymaster nodes
- add more solvers before expanding the gateway tier
- add more storage or artifact nodes before collapsing roles back together

## 8. Minimal Manifest Shape

The operator view usually starts with a manifest like this:

```yaml
version: 1
nodes:
  - name: gateway-1
    role: gateway
    baseUrl: https://gateway.example.com/operator
    authToken: replace-me-gateway-token

  - name: host-1
    role: host
    baseUrl: https://host.example.com/operator
    authToken: replace-me-host-token

  - name: solver-1
    role: solver
    baseUrl: https://solver.example.com/operator
    authToken: replace-me-solver-token

  - name: storage-1
    role: storage
    baseUrl: https://storage.example.com/operator
    authToken: replace-me-storage-token

  - name: artifact-1
    role: artifacts
    baseUrl: https://artifacts.example.com/operator
    authToken: replace-me-artifact-token

  - name: exec-1
    role: signer-paymaster
    baseUrl: https://exec.example.com/operator
    authToken: replace-me-exec-token
```

The exact role labels are operator metadata. What matters to the CLI is that
the node exposes a reachable authenticated operator endpoint.

## 9. Summary

Use this six-node layout when you want a small OpenFox network that is:

- public enough to expose services
- private enough to keep providers behind a relay
- modular enough to separate storage, artifacts, and execution authority
- operable enough that one person can manage it from a single operator surface

The key idea is simple:

- runtime work happens on the six role nodes
- fleet visibility happens on `operator-box`
- high-risk execution stays bounded
- durable result handling stays off the hot path

That is the smallest shape that already behaves more like an agent network than
like a single long-running bot process.
