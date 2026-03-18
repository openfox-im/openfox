# OpenFox Doctor and Health Guide

OpenFox now exposes two operator-facing diagnostic commands inspired by the
OpenClaw runtime surface:

- `openfox health`
- `openfox doctor`

They serve different purposes.

## 1. `openfox health`

Use this for a quick runtime snapshot.

```bash
openfox health
openfox health --json
```

It reports:

- whether config and wallet files exist
- whether an inference backend is configured
- whether chain RPC is configured
- whether discovery/provider/gateway mode is enabled
- heartbeat paused state
- pending wake count
- managed service status
- service/gateway health probe summaries

Use it when you want a compact operator view of the current runtime state.

## 2. `openfox doctor`

Use this when something is wrong or when you want a repair-oriented diagnostic.

```bash
openfox doctor
openfox doctor --json
```

It turns runtime checks into findings with severity and next-step guidance.

Current checks include:

- config file presence
- wallet file presence
- inference provider configuration
- RPC configuration and probe result
- managed service install/active state
- heartbeat paused state
- pending wake backlog
- enabled skills that are missing requirements
- provider/gateway probe failures

Typical recommendations include:

- run `openfox --setup`
- run `openfox --configure`
- run `openfox service install`
- run `openfox service restart`
- inspect `openfox skills status <name>`

## 3. When to use which

- `openfox health`
  - fast runtime snapshot
  - better for dashboards and routine checks
- `openfox doctor`
  - repair and troubleshooting
  - better when startup or service behavior is degraded

## 4. Machine-readable output

Both commands support JSON output:

```bash
openfox health --json
openfox doctor --json
```

This is intended for future control-plane, UI, or automation integrations.
