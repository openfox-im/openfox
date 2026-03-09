# OpenFox Bounty Host/Solver Guide

This guide shows the first question-bounty loop for OpenFox:

- one host OpenFox
- one solver OpenFox
- local-model judging
- native `TOS` payout
- optional host auto-open
- optional solver auto-discovery and auto-submit

## 1. Goal

The MVP flow is:

1. the host opens a bounded question bounty
2. the solver discovers or reads the bounty
3. the solver submits one answer
4. the host judges with the local model
5. the host pays native `TOS` if the answer is accepted

## 2. Host Configuration

Add a `bounty` section to `~/.openfox/openfox.json`:

```json
{
  "rpcUrl": "http://127.0.0.1:8545",
  "chainId": 1666,
  "bounty": {
    "enabled": true,
    "role": "host",
    "skill": "question-bounty-host",
    "bindHost": "127.0.0.1",
    "port": 4891,
    "pathPrefix": "/bounty",
    "discoveryCapability": "bounty.submit",
    "rewardWei": "10000000000000000",
    "autoPayConfidenceThreshold": 0.9,
    "defaultSubmissionTtlSeconds": 3600,
    "pollIntervalSeconds": 30,
    "maxOpenBounties": 10,
    "judgeMode": "local_model",
    "autoOpenOnStartup": true,
    "autoOpenWhenIdle": true,
    "openingPrompt": "Ask one short factual question with a short canonical answer."
  }
}
```

If `agentDiscovery.enabled` and `agentDiscovery.publishCard` are also enabled,
the host automatically publishes these capabilities:

- `bounty.list`
- `bounty.get`
- `bounty.submit`
- `bounty.result`

## 3. Solver Configuration

The solver uses a smaller bounty config:

```json
{
  "rpcUrl": "http://127.0.0.1:8545",
  "chainId": 1666,
  "bounty": {
    "enabled": true,
    "role": "solver",
    "skill": "question-bounty-solver",
    "bindHost": "127.0.0.1",
    "port": 4891,
    "pathPrefix": "/bounty",
    "remoteBaseUrl": "http://127.0.0.1:4891/bounty",
    "discoveryCapability": "bounty.submit",
    "rewardWei": "10000000000000000",
    "autoPayConfidenceThreshold": 0.9,
    "defaultSubmissionTtlSeconds": 3600,
    "pollIntervalSeconds": 30,
    "maxOpenBounties": 10,
    "judgeMode": "local_model",
    "autoOpenOnStartup": false,
    "autoSolveOnStartup": true,
    "autoSolveEnabled": true
  }
}
```

## 4. Running the Host

Start the host runtime:

```bash
openfox --run
```

Open a bounty:

```bash
openfox bounty open \
  --question "Capital of France?" \
  --answer "Paris"
```

Inspect local bounties:

```bash
openfox bounty list
openfox bounty status <bounty-id>
```

Or let the host create one automatically on startup:

- set `autoOpenOnStartup: true`
- optionally set `autoOpenWhenIdle: true`
- optionally set `openingPrompt`

## 5. Running the Solver

The solver does not need direct database access to the host.

List remote bounties:

```bash
openfox bounty list --url http://127.0.0.1:4891/bounty
```

Solve and submit automatically:

```bash
openfox bounty solve <bounty-id> --url http://127.0.0.1:4891/bounty
```

Or let the solver run continuously:

- set `autoSolveOnStartup: true`
- set `autoSolveEnabled: true`
- set `remoteBaseUrl` for a direct host
- or enable Agent Discovery and let OpenFox find `bounty.submit` providers

Submit a manual answer:

```bash
openfox bounty submit <bounty-id> \
  --url http://127.0.0.1:4891/bounty \
  --answer "Paris"
```

## 6. Host API

The host exposes:

- `GET /bounty/healthz`
- `GET /bounty/bounties`
- `POST /bounty/bounties`
- `GET /bounty/bounties/:id`
- `POST /bounty/bounties/:id/submit`
- `GET /bounty/bounties/:id/result`

## 7. Current MVP Limits

The current slice is intentionally narrow:

- question bounties only
- one submission per bounty
- one local-model judge pass
- zero or one payout
- no manual review mode
- no dispute mode

This is enough to prove the host/solver/reward loop without turning OpenFox
into a full marketplace yet.
