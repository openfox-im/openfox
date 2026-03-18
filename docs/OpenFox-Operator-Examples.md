# OpenFox Operator Examples

## 1. Task Sponsor

Use the `task-sponsor` template when one operator funds and publishes work.

Typical commands:

```bash
pnpm openfox templates export task-sponsor --output ./task-sponsor
pnpm openfox --run
pnpm openfox bounty list --json
```

## 2. Public Provider

Use the `public-provider` template when the operator offers:

- paid observation
- paid oracle resolution
- gateway-backed external access

Typical commands:

```bash
pnpm openfox templates export public-provider --output ./public-provider
pnpm openfox doctor
pnpm openfox payments list
pnpm openfox service status
```

## 3. Gateway Operator

Run the gateway profile when you want to make private providers reachable
without public IPs on every provider host.

Typical checks:

```bash
pnpm openfox gateway status
pnpm openfox service status
pnpm openfox logs --tail 200
```

## 4. Local Marketplace Operator

Use the local marketplace template for a single-host test stack:

- host
- solver
- scout

This is the recommended first proving ground before multi-machine deployment.
