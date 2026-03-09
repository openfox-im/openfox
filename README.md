# 🦊OpenFox

<p align="center">
  <img src="LOGO.png" alt="OpenFox logo" width="296" />
</p>

**While you sleep, Fox keeps working and brings the coins back.**

OpenFox is a continuously running AI agent runtime built to keep working in the background:

- watching for opportunities
- calling tools
- executing tasks
- handling payments
- settling work
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

OpenFox is a **local-first, wallet-native, payment-aware AI agent runtime**.

It is designed to run continuously, maintain its own state, use local and remote tools, manage wallets and payment flows, and optimize around long-lived value creation instead of single-turn chat.

OpenFox is meant to be:

- an agent that keeps running
- an agent that controls its own wallet
- an agent that can take work, execute, and settle
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

That makes it an extensible agent runtime rather than a fixed-purpose application.

---

## Product Direction

OpenFox is not trying to be "another AI chat app".

It is trying to become:

**an AI agent runtime that can work and earn automatically.**

The shortest description is:

> OpenFox is the fox that keeps working on your machine.  
> While you sleep, it keeps watching, executing, and bringing the coins back.

The near-term product direction includes:

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
```

The preferred command surface is:

```bash
openfox --setup
openfox --run
openfox onboard --install-daemon
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

The local state directory is:

```bash
~/.openfox/
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
openfox gateway status
openfox gateway status --json
openfox health
openfox doctor
openfox models status
openfox onboard --install-daemon
openfox logs --tail 200
openfox bounty --help
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
- native TOS transfer signing
- native TOS transfer sending
- TOS `x402` exact payment selection and payment flow

CLI examples:

```bash
openfox-cli tos-status
openfox-cli tos-send 0x... 0.01
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
```

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

OpenFox now includes the first bounty runtime slice for the `question-bounty`
MVP.

Host-side:

```bash
openfox bounty open --question "Capital of France?" --answer "Paris"
openfox bounty list
openfox bounty status <bounty-id>
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
- direct solver-to-host mode with `remoteBaseUrl`
- discovery-based solver mode through `bounty.submit`

For a concrete host/solver walkthrough, see:

- [OpenFox-Bounty-Host-Solver-Guide.md](./docs/OpenFox-Bounty-Host-Solver-Guide.md)

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
