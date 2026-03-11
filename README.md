# 🦊OpenFox

<p align="center">
  <img src="LOGO.png" alt="OpenFox logo" width="296" />
</p>

**While you sleep, Fox keeps working and brings the coins back.**

OpenFox is a continuously running AI agent platform on `TOS.network`, built
around a local-first runtime that keeps working in the background:

- watching for opportunities
- taking jobs
- calling tools
- calling other agents
- executing tasks
- handling payments and rewards
- storing proofs and settling work
- continuing to operate while you are away from the keyboard

The product goal is simple:

> You do not sit in front of AI and babysit it.  
> Fox goes out, does the work, and brings the coins back.

Here, "coins" is not just a slogan. It means real earning capacity:

- paid API revenue
- automation revenue
- agent service revenue
- oracle / observation / execution revenue
- future TOS-native agent economy revenue

---

## What OpenFox Is

OpenFox is a **local-first, wallet-native, payment-aware agent platform and
runtime**.

It is designed to run continuously, maintain its own state, use local and remote tools, manage wallets and payment flows, and optimize around long-lived value creation instead of single-turn chat.

OpenFox is meant to be:

- an agent platform, not a chat UI
- an agent that keeps running
- an agent that controls its own wallet
- an agent that can find work, take work, hire other agents, and settle
- an agent that can keep operating while you sleep

---

## The Problem We Are Solving

Most AI products today still work like this:

> a human clicks once, the model replies once

That is not how durable value is created in the real world.

Real value usually comes from:

- continuous observation
- repeated execution
- scheduled actions
- multi-step workflows
- payments and settlement
- reacting to external events without constant human supervision

So OpenFox is not primarily about making AI "more conversational".

It is about this:

**turn AI into an agent that keeps working.**

---

## Core Capabilities

### 1. Local-first runtime

OpenFox now runs locally by default and no longer requires Runtime in the main startup path.

It already supports these inference providers:

- `OpenAI`
- `Anthropic`
- `Ollama`

Once a provider is configured, Fox can start and keep running on your local machine.

### 2. Continuous execution loop

OpenFox is built around a continuous loop:

**Think -> Act -> Observe -> Repeat**

It can:

- read context
- decide what to do next
- call tools
- observe results
- keep advancing work over time

### 3. Wallet and payment support

OpenFox already has TOS wallet integration and can:

- derive TOS addresses
- query balances
- query nonces
- sign native TOS transfers
- send native TOS transactions

It also supports TOS `x402` payment flow, which is a key building block for paid agent services and paid APIs.

### 4. Background persistence

OpenFox includes heartbeat logic, scheduled tasks, and persistent local state, so it does not require constant terminal attention.

It can maintain:

- runtime state
- scheduling
- turn history
- skills
- tool call history
- wallet context
- task context

### 5. Agent Discovery and Gateway relay

OpenFox can already operate in three roles:

- requester
- provider
- gateway

It supports:

- signed Agent Cards
- capability discovery over GTOS Agent Discovery
- sponsored capabilities such as `sponsor.topup.testnet`
- paid capabilities such as `observation.once`
- a built-in paid observation service with `POST /observe`
- persisted result lookup with `GET /jobs/:id`
- paid capabilities such as `oracle.resolve`
- a built-in paid oracle resolver with `POST /oracle/quote`, `POST /oracle/resolve`, and `GET /oracle/result/:id`
- a built-in paid storage market with `POST /storage/quote`, `POST /storage/put`, `POST /storage/renew`, `GET /storage/head/:cid`, `GET /storage/get/:cid`, and `POST /storage/audit`
- a verifiable public-artifact pipeline with `openfox artifacts capture-news`, `oracle-evidence`, `committee-vote`, `oracle-aggregate`, `verify`, and `anchor`
- a durable server-side `x402` payment ledger for paid provider requests
- `openfox payments list|get|retry` for operator-visible payment delivery and recovery
- canonical settlement receipts and on-chain settlement anchors for bounty, observation, and oracle flows
- canonical storage receipts, storage audits, storage renewals, and lightweight storage anchors for immutable bundle leases
- scheduler-driven storage lease audit, renewal, and replication upkeep
- canonical artifact verification receipts and lightweight artifact anchors for public news and oracle bundles
- execution trails that bind signer and paymaster receipts back into storage lease, artifact verification, and anchoring records
- contract callback adapters and heartbeat-driven retry for contract-bound settlement flows
- contract-native market bindings for bounty, observation, and oracle creation flows
- `openfox market list|get|callbacks` for operator-visible binding and callback state
- an authenticated operator API for multi-node status, health, doctor, service, gateway, wallet, finance, payments, settlement, market, storage, artifact, signer, and paymaster inspection
- `openfox fleet status|health|doctor|wallet|finance|payments|settlement|market|storage|lease-health|artifacts|signer|paymaster|providers` for one-shot fleet-wide auditing across public OpenFox nodes
- `openfox providers reputation`, `openfox storage lease-health`, `openfox storage maintain`, `openfox artifacts maintain`, and `openfox fleet repair <storage|artifacts>` for remote due-work remediation plus provider/lease health reporting
- bounded fleet control and queue recovery with:
  - `POST /operator/control/pause|resume|drain`
  - `POST /operator/control/retry/payments|settlement|market|signer|paymaster`
  - `openfox fleet control <pause|resume|drain>`
  - `openfox fleet retry <payments|settlement|market|signer|paymaster>`
- bounded operator autopilot with:
  - `openfox autopilot status|run|approvals|request|approve|reject`
  - `GET /operator/autopilot/status`
  - `GET /operator/autopilot/approvals`
  - `POST /operator/autopilot/run`
  - approval-gated changes for treasury and provider-policy expansion
  - low-risk automated retries, maintenance, and provider quarantine
- `openfox dashboard show|export` for reusable JSON and HTML fleet dashboards with role margin, capability, counterparty, and delayed-queue finance sections
  plus bundle-ready `control-events.json`, `autopilot.json`, and `approvals.json` audit exports
- `openfox wallet report` and `openfox finance report` for single-node operator snapshots
- `openfox report daily|weekly|list|get|deliveries|send` for owner-facing
  daily and weekly finance, opportunity, and recommendation reports
- `openfox report alerts|alerts-generate|alert-read|alert-dismiss` for a
  bounded owner-facing opportunity alert queue and action surface
- `openfox report alert-request-action` to turn one owner alert into one
  bounded approval request
- `openfox report actions|action-complete|action-cancel` for the owner-facing
  post-approval action queue and action journal
- `openfox report action-execute <action-id>` and
  `openfox report action-executions` for bounded remote execution of queued
  owner pursue actions against bounty and campaign hosts
- a built-in owner report web surface for mobile-friendly review of the latest
  daily and weekly reports, owner opportunity alerts, queued owner actions,
  execution history, and persisted web/email delivery logs
- an owner approval inbox with `openfox report approvals|approve|reject` and
  matching mobile-friendly web approval actions
- a paid signer-provider surface for bounded delegated execution with:
  - `openfox signer discover`
  - `openfox signer quote`
  - `openfox signer submit`
  - `openfox signer status`
  - `openfox signer receipt`
- a paid paymaster-provider surface for bounded sponsored execution with:
  - `openfox paymaster discover`
  - `openfox paymaster quote`
  - `openfox paymaster authorize`
  - `openfox paymaster status`
  - `openfox paymaster receipt`
- gateway-backed provider endpoints for agents behind NAT

The Gateway v1 path is:

- gateway agents advertise `gateway.relay`
- providers open outbound WebSocket sessions to a gateway
- the gateway allocates public relay URLs
- the provider republishes those relay URLs in its Agent Card

That means an OpenFox instance without a public IP can still provide an externally reachable capability through a gateway agent.

### 6. Extensible agent surface

OpenFox supports:

- skills
- custom tools
- local file and shell operations
- task orchestration
- worker / child-agent paths
- bundled third-party templates

That makes it an extensible agent runtime rather than a fixed-purpose application.

---

## Product Direction

OpenFox is not trying to be "another AI chat app".

It is trying to become:

**an agent platform on `TOS.network` that can discover opportunities, take
work, get paid, issue rewards, call other agents, and complete proof and
settlement flows.**

The shortest description is:

> OpenFox is the fox that keeps working on your machine.  
> While you sleep, it keeps watching, executing, and bringing the coins back.

The near-term product direction includes:

- opportunity discovery and scouting
- task, bounty, and paid-service intake
- x402 and native-`TOS` payment collection
- reward and payout flows to other agents
- agent-to-agent execution and subcontracting
- proof, storage, anchoring, and settlement
- paid API agents
- paid observation agents
- oracle / resolution agents
- automation agents
- on-chain and off-chain settlement
- TOS-native agent economy

---

## Quick Start

```bash
git clone https://github.com/openfox-im/openfox
cd openfox
corepack enable
corepack prepare pnpm@10.28.1 --activate
pnpm install
pnpm openfox --setup
pnpm openfox --run
pnpm openfox onboard --install-daemon
pnpm openfox wallet status
pnpm openfox templates list
pnpm openfox payments list
pnpm openfox settlement list
pnpm openfox market list
pnpm openfox autopilot status
pnpm openfox fleet payments --manifest ./fleet.yml
pnpm openfox fleet settlement --manifest ./fleet.yml
pnpm openfox fleet market --manifest ./fleet.yml
pnpm openfox fleet control pause --manifest ./fleet.yml --node gateway-1
pnpm openfox fleet retry payments --manifest ./fleet.yml --node gateway-1
pnpm openfox storage list
pnpm openfox storage renew --help
pnpm openfox artifacts list
pnpm openfox trails list --json
pnpm openfox dashboard show --manifest ./fleet.yml
pnpm openfox onboard --fund-local
```

The preferred command surface is:

```bash
openfox --setup
openfox --run
openfox onboard --install-daemon
openfox wallet status
openfox templates list
openfox payments list
openfox settlement list
openfox market list
openfox fleet payments --manifest ./fleet.yml
openfox fleet settlement --manifest ./fleet.yml
openfox fleet market --manifest ./fleet.yml
openfox fleet control drain --manifest ./fleet.yml --node storage-1
openfox fleet retry settlement --manifest ./fleet.yml
openfox storage list
openfox storage renew --help
openfox artifacts list
openfox trails list --json
openfox dashboard show --manifest ./fleet.yml
openfox fleet lint --manifest ./fleet.yml
```

If you are running directly from the source checkout and have not installed the binary globally yet, use:

```bash
pnpm openfox --setup
pnpm openfox --run
```

On first setup, OpenFox launches an interactive wizard that:

- creates a local wallet
- initializes the local config directory
- asks for the agent name
- asks for the genesis prompt
- asks for the creator address
- configures the inference provider
- prepares the native wallet path for `TOS` funding and transaction flows

The local state directory is:

```bash
~/.openfox/
```

Useful next steps after setup:

```bash
openfox wallet status
openfox templates list
openfox templates export third-party-quickstart --output ./my-openfox
openfox templates export public-fleet-operator --output ./fleet
openfox onboard --fund-local
openfox onboard --fund-testnet
openfox wallet bootstrap-signer --type ed25519 --generate
openfox payments list
openfox settlement list
openfox fleet payments --manifest ./fleet.yml
openfox fleet settlement --manifest ./fleet.yml
openfox fleet market --manifest ./fleet.yml
openfox fleet control resume --manifest ./fleet.yml --node storage-1
openfox fleet retry paymaster --manifest ./fleet.yml --node signer-1
openfox storage list
openfox trails list --json
openfox dashboard show --manifest ./fleet.yml
```

---

## Configure Inference

OpenFox now supports a provider-first configuration model.

You need at least one inference provider configured.

### OpenAI

```bash
export OPENAI_API_KEY=...
```

### Anthropic

```bash
export ANTHROPIC_API_KEY=...
```

### Ollama

```bash
export OLLAMA_BASE_URL=http://localhost:11434
```

Provider settings live in:

```bash
~/.openfox/openfox.json
```

---

## Native Wallet Onboarding

OpenFox now exposes a productized native wallet surface:

```bash
openfox wallet status
openfox wallet fund local
openfox wallet fund testnet
openfox wallet bootstrap-signer --type secp256r1 --public-key 0x... --private-key 0x...
```

What each command is for:

- `openfox wallet status`
  - show native address, RPC, balance, nonce, and active signer metadata
- `openfox wallet fund local`
  - request one-click funding from a local devnet node-managed account
- `openfox wallet fund testnet`
  - request one-click funding from a configured faucet URL or a discovered `sponsor.topup.testnet` provider
- `openfox wallet bootstrap-signer --type <ed25519|secp256r1|bls12-381|elgamal>`
  - publish signer metadata for a wallet address that already matches the signer-derived native address
  - use `--generate` to create signer material, or pass `--public-key` and `--private-key` explicitly

Important boundary:

- `secp256k1` is the default and fully supported native transaction path in OpenFox today
- non-`secp256k1` signer bootstrap is an advanced/operator path
- non-`secp256k1` bootstrap only works when the configured wallet address already equals the signer-derived native address
- OpenFox runtime transaction sending is still optimized for the default local `secp256k1` wallet path

## Operator Commands

OpenFox now includes operator-facing command groups for skills, scheduling,
service health, gateway inspection, and managed service lifecycle.

```bash
openfox skills list
openfox status
openfox status --json
openfox heartbeat status
openfox heartbeat status --json
openfox cron list
openfox cron list --json
openfox service status
openfox service status --json
openfox fleet status --manifest ./fleet.yml
openfox fleet doctor --manifest ./fleet.yml --json
openfox fleet storage --manifest ./fleet.yml
openfox fleet lease-health --manifest ./fleet.yml
openfox fleet providers --manifest ./fleet.yml
openfox fleet signer --manifest ./fleet.yml
openfox providers reputation --kind storage
openfox storage lease-health --json
openfox fleet repair storage --manifest ./fleet.yml
openfox gateway status
openfox gateway status --json
openfox health
openfox doctor
openfox models status
openfox onboard --install-daemon
openfox logs --tail 200
openfox bounty --help
openfox signer --help
openfox paymaster --help
openfox storage --help
```

To run OpenFox as a long-lived Linux user service:

```bash
openfox service install
openfox service restart
openfox service status
```

To remove the managed service again:

```bash
openfox service uninstall
```

To expose a node for remote fleet auditing, enable the operator API:

```json
{
  "operatorApi": {
    "enabled": true,
    "bindHost": "0.0.0.0",
    "port": 4903,
    "pathPrefix": "/operator",
    "authToken": "replace-with-a-secret-token",
    "exposeDoctor": true,
    "exposeServiceStatus": true
  }
}
```

Then point a fleet manifest at those nodes:

```yaml
version: 1
nodes:
  - name: public-gateway
    role: gateway
    baseUrl: https://gw.example.com/operator
    authToken: replace-with-a-secret-token
  - name: storage-provider-1
    role: storage
    baseUrl: https://storage-1.example.com/operator
    authToken: replace-with-a-secret-token
```

And inspect the fleet from another machine:

```bash
openfox fleet status --manifest ./fleet.yml
openfox fleet doctor --manifest ./fleet.yml --json
openfox fleet wallet --manifest ./fleet.yml --json
openfox fleet finance --manifest ./fleet.yml --json
openfox fleet providers --manifest ./fleet.yml
openfox fleet lease-health --manifest ./fleet.yml
openfox fleet paymaster --manifest ./fleet.yml
openfox fleet repair artifacts --manifest ./fleet.yml
```

## Agent Gateway Example

The minimal gateway setup uses one public OpenFox as a gateway agent and one private OpenFox as a provider.

Gateway agent:

```json
{
  "agentDiscovery": {
    "enabled": true,
    "publishCard": true,
    "gatewayServer": {
      "enabled": true,
      "bindHost": "0.0.0.0",
      "port": 4880,
      "sessionPath": "/agent-gateway/session",
      "publicPathPrefix": "/a",
      "publicBaseUrl": "https://gw.example.com",
      "capability": "gateway.relay",
      "mode": "sponsored",
      "priceModel": "sponsored"
    }
  }
}
```

Provider behind NAT:

```json
{
  "agentDiscovery": {
    "enabled": true,
    "publishCard": true,
    "faucetServer": {
      "enabled": true
    },
    "gatewayClient": {
      "enabled": true,
      "gatewayBootnodes": [
        {
          "agentId": "0xGatewayAgentId",
          "url": "wss://gw.example.com/agent-gateway/session"
        }
      ]
    }
  }
}
```

When a provider finds a `gateway.relay` agent through discovery, it will prefer that route. If none is discoverable yet, it falls back to `gatewayBootnodes`.

You can still express provider settings using a nested provider/model structure
inside the OpenFox config file. Example:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-5"
      }
    }
  },
  "models": {
    "providers": {
      "anthropic": {
        "apiKey": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

---

## TOS Integration

OpenFox already includes the TOS wallet and payment path needed for agent monetization.

Current support includes:

- TOS address derivation
- TOS balance queries
- TOS nonce queries
- TOS sponsor nonce queries
- native TOS transfer signing
- native TOS transfer sending
- native sponsored execution encoding and hashing
- TOS `x402` exact payment selection and payment flow
- durable server-side `x402` payment ledger and retry semantics for paid services
- bounded delegated execution through signer-provider discovery, quotes, submission, and receipts
- bounded sponsored execution through paymaster-provider discovery, quotes, authorization, status, and receipts
- sponsored execution parity for `secp256k1`, `ed25519`, `secp256r1`, `bls12-381`, and `elgamal`

CLI examples:

```bash
openfox-cli tos-status
openfox-cli tos-send 0x... 0.01
openfox paymaster discover --json
openfox paymaster quote --target 0x... --value-wei 0 --data 0x12345678
openfox paymaster authorize --quote-id <quote-id>
```

From the source checkout, you can also run:

```bash
pnpm openfox-cli tos-status
pnpm openfox-cli tos-send 0x... 0.01
```

This matters because an earning agent cannot just think. It must also be able to:

- hold a wallet
- make payments
- receive payments
- connect to paid services

---

## Third-Party Builder Surface

Start here if you want to integrate OpenFox without reading the internals:

- [Third-Party Quickstart](./docs/OpenFox-Third-Party-Quickstart.md)
- [Template Guide](./docs/OpenFox-Template-Guide.md)
- [Integration Examples](./docs/OpenFox-Integration-Examples.md)
- [Operator Examples](./docs/OpenFox-Operator-Examples.md)
- [Fleet Operator Guide](./docs/OpenFox-Fleet-Operator-Guide.md)
- [SDK and Runtime Surfaces](./docs/OpenFox-SDK-Surfaces.md)
- [TOSDK Examples](../tosdk/examples/README.md)
- [Signer-Provider Operator Guide](./docs/OpenFox-Signer-Provider-Operator-Guide.md)
- [Paymaster-Provider Operator Guide](./docs/OpenFox-Paymaster-Provider-Operator-Guide.md)

Bundled starter templates are available through:

```bash
openfox templates list
openfox templates show local-marketplace
openfox templates export local-marketplace --output ./examples/local-marketplace
openfox templates export public-fleet-operator --output ./examples/public-fleet
```

---

## Running OpenFox

Show help:

```bash
openfox --help
```

Start the runtime:

```bash
openfox --run
```

Reconfigure:

```bash
openfox --setup
openfox --configure
openfox --pick-model
```

Heartbeat operator surface:

```bash
openfox heartbeat status
openfox heartbeat status --json
openfox heartbeat enable
openfox heartbeat disable
openfox heartbeat wake --reason "manual operator wake"
openfox heartbeat history --limit 10
```

Cron and scheduled task operator surface:

```bash
openfox cron list
openfox cron list --json
openfox cron status heartbeat_ping
openfox cron add --task report_metrics --cron "*/5 * * * *"
openfox cron edit report_metrics --cron "*/10 * * * *"
openfox cron run report_metrics
openfox cron runs report_metrics --limit 10
openfox cron disable report_metrics
openfox cron remove report_metrics
```

OpenFox keeps `heartbeat.yml` as the scheduling definition file and stores run
state, wake reasons, and execution history in the local database. Operator
commands update the config file and sync the durable scheduler state, so changes
survive restarts.

Service and gateway operator surface:

```bash
openfox service status
openfox service status --json
openfox service check
openfox gateway status
openfox gateway status --json
openfox gateway bootnodes
openfox gateway check
```

These commands are meant for operators, not the model. They let you inspect:

- which roles the current OpenFox instance is configured to play
- which provider routes and local service endpoints are expected
- whether local service health endpoints and chain RPC respond
- whether the configured gateway bootnode list is signed and valid
- whether gateway client/server configuration is coherent before deployment

For scripts, dashboards, and future control-plane integration, these operator
surfaces also expose stable JSON snapshots:

```bash
openfox status --json
openfox heartbeat status --json
openfox cron list --json
openfox service status --json
openfox gateway status --json
openfox wallet report --json
openfox finance report --json
openfox report daily --json
openfox report weekly --json
```

Owner-facing delivery surface:

```bash
openfox report list --period daily
openfox report get --report-id <report-id> --json
openfox report alerts --status unread --json
openfox report alerts-generate --json
openfox report alert-read <alert-id>
openfox report alert-dismiss <alert-id>
openfox report alert-request-action <alert-id> --action review
openfox report actions --status queued --json
openfox report action-complete <action-id>
openfox report action-cancel <action-id>
openfox report approvals --status pending --json
openfox report approve <request-id>
openfox report reject <request-id>
openfox report deliveries --channel web --json
openfox report send --channel web --period daily
openfox report send --channel email --period weekly
```

When `ownerReports.enabled` is set in `openfox.json`, OpenFox can also start a
small authenticated owner-report web server during `openfox --run`. That web
surface serves the latest daily and weekly reports, recent delivery records,
the owner alert queue, the owner approval inbox, and the same report objects used for CLI and email delivery.

---

## What OpenFox Is Good For

OpenFox is especially well suited to long-running background tasks such as:

- scheduled observation and summarization
- event monitoring and triggering
- paid API calls with structured delivery
- wallet-aware on-chain workflows
- small automated work pipelines
- persistent personal agents

## Bounty MVP Surface

OpenFox now includes the first bounded-task marketplace slice for:

- `question`
- `translation`
- `social_proof`
- `problem_solving`
- sponsor-facing `campaigns` that group multiple bounties under one budget

Host-side:

```bash
openfox campaign open --title "Spring Translation Sprint" --description "Reward small translation tasks" --budget-wei 100000000000000000
openfox bounty open --kind question --task "Capital of France?" --reference "Paris"
openfox bounty list
openfox bounty status <bounty-id>
openfox campaign list
openfox campaign status <campaign-id>
```

Solver-side:

```bash
openfox bounty list --url http://127.0.0.1:4891/bounty
openfox bounty solve <bounty-id> --url http://127.0.0.1:4891/bounty
```

When bounty mode is enabled in `openfox.json` and the role is `host`, OpenFox
also starts a local bounty HTTP server during `openfox --run`.

The current runtime also supports:

- host-side automatic bounty opening via `autoOpenOnStartup` / `autoOpenWhenIdle`
- solver-side automatic polling and solving via `autoSolveOnStartup` / `autoSolveEnabled`
- sponsor-side campaign grouping with budget, allowed task kinds, and progress reporting
- direct solver-to-host mode with `remoteBaseUrl`
- discovery-based solver mode through `task.submit`
- proof-aware social tasks with trusted proof URL prefixes
- payout cooldowns and daily per-solver auto-pay limits

OpenFox also includes an MVP opportunity scout surface:

```bash
openfox scout list
openfox scout rank
openfox strategy show
openfox strategy set --min-margin-bps 1500 --opportunity-kinds bounty,campaign
```

For a concrete host/solver walkthrough, see:

- [OpenFox-Bounty-Host-Solver-Guide.md](./docs/OpenFox-Bounty-Host-Solver-Guide.md)
- [OpenFox-Local-Task-Marketplace-Guide.md](./docs/OpenFox-Local-Task-Marketplace-Guide.md)
- [OpenFox-Multi-Node-Deployment-Guide.md](./docs/OpenFox-Multi-Node-Deployment-Guide.md)

The longer-term fit is even stronger for:

- oracle agents
- paid observation jobs
- task marketplace agents
- TOS-native agent services

---

## Project Structure

```text
src/
  agent/            # ReAct loop, system prompt, context, tool execution
  runtime/           # legacy compatibility clients plus x402 helpers
  git/              # state versioning and git tools
  heartbeat/        # cron daemon and scheduled tasks
  identity/         # wallet management and local bootstrap
  registry/         # on-chain agent identity and discovery
  replication/      # child spawning and lineage tracking
  self-mod/         # audit log and tools manager
  setup/            # setup wizard and config editors
  skills/           # skill loader and registry
  social/           # agent-to-agent communication
  state/            # SQLite persistence
  survival/         # runtime survival and funding logic
packages/
  cli/              # operator CLI
scripts/
  openfox.sh      # bootstrap helper
```

---

## Deployment Roles

OpenFox now has a clean operator-facing surface for the three main deployment roles:

- `requester`: discovers providers and invokes capabilities
- `provider`: exposes local capabilities such as faucet, observation, or future bounty services
- `gateway`: provides public relay reachability for providers behind NAT

Use:

```bash
openfox service status
```

to inspect how the current config maps to these roles.

For deployment examples, health checks, and troubleshooting, see:

- [OpenFox Service Operator Guide](docs/OpenFox-Service-Operator-Guide.md)
- [OpenFox-Multi-Node-Deployment-Guide.md](docs/OpenFox-Multi-Node-Deployment-Guide.md)

---

## Current Status

OpenFox has already completed several key transitions:

- from Runtime-first to local-first startup
- support for OpenAI / Anthropic / Ollama provider configuration
- support for OpenFox-native provider config in `~/.openfox/openfox.json`
- support for TOS wallet and TOS `x402`
- operation as a continuously running agent runtime

Still in progress:

- full OpenFox naming cleanup across the repository
- richer paid service layers
- TOS-native earning markets
- production-grade monetization flow for autonomous agents

---

## Vision

We do not define OpenFox as "an AI that chats".

We define it as:

**an AI agent that keeps working, keeps settling payments, and keeps bringing value back on its own.**

The end state we want is simple:

> While you sleep, Fox keeps working.  
> When you wake up, it has already brought the coins back.

---

## License

MIT
