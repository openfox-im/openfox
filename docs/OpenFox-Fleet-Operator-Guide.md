# OpenFox Fleet Operator Guide

This guide describes the minimum operator surface for auditing multiple
OpenFox nodes that expose public storage, artifact, signer, paymaster, gateway,
or marketplace roles.

## 1. Enable the Operator API on Each Node

Add this to `~/.openfox/openfox.json` on every node that should be visible to a
fleet operator:

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

Recommended practice:

- use a long random bearer token
- terminate public access behind HTTPS
- keep `/operator/healthz` public only for basic load balancer checks
- require auth for `/operator/status`, `/operator/health`, `/operator/doctor`,
  `/operator/service/status`, and `/operator/gateway/status`

## 2. Supported Operator API Endpoints

- `GET /operator/healthz`
- `GET /operator/status`
- `GET /operator/health`
- `GET /operator/doctor`
- `GET /operator/service/status`
- `GET /operator/gateway/status`
- `GET /operator/storage/status`
- `GET /operator/artifacts/status`
- `GET /operator/signer/status`
- `GET /operator/paymaster/status`

Authenticated requests accept either:

- `Authorization: Bearer <token>`
- `X-OpenFox-Operator-Token: <token>`

## 3. Create a Fleet Manifest

`fleet.yml`

```yaml
version: 1
nodes:
  - name: public-gateway
    role: gateway
    baseUrl: https://gw.example.com/operator
    authToken: replace-with-a-secret-token

  - name: signer-provider-1
    role: signer
    baseUrl: https://signer-1.example.com/operator
    authToken: replace-with-a-secret-token

  - name: paymaster-provider-1
    role: paymaster
    baseUrl: https://paymaster-1.example.com/operator
    authToken: replace-with-a-secret-token

  - name: storage-provider-1
    role: storage
    baseUrl: https://storage-1.example.com/operator
    authToken: replace-with-a-secret-token
```

Both JSON and YAML manifests are supported.

## 4. Audit the Fleet

```bash
openfox fleet lint --manifest ./fleet.yml
openfox fleet status --manifest ./fleet.yml
openfox fleet health --manifest ./fleet.yml
openfox fleet doctor --manifest ./fleet.yml --json
openfox fleet storage --manifest ./fleet.yml
openfox fleet lease-health --manifest ./fleet.yml
openfox fleet artifacts --manifest ./fleet.yml
openfox fleet signer --manifest ./fleet.yml
openfox fleet paymaster --manifest ./fleet.yml
openfox fleet providers --manifest ./fleet.yml
openfox providers reputation --kind storage
openfox storage lease-health --json
openfox fleet repair storage --manifest ./fleet.yml
openfox fleet repair artifacts --manifest ./fleet.yml
```

Use these to answer questions such as:

- whether the manifest still contains placeholders or duplicate entries
- which nodes are reachable
- which nodes fail health checks
- which public deployments have misconfigured operator auth
- which gateway/service roles are currently exposed
- which storage nodes have due renewals or under-replicated bundles
- which individual storage leases are currently healthy, warning, or critical
- which artifact nodes are storing, verifying, and anchoring bundles
- which signer fleets have pending delegated executions
- which paymaster fleets are funded, pending, or running with limited signer parity
- which provider roles are accumulating weak local reputation due to failures, pending work, or audit debt

## 5. Recommended Use

Use fleet auditing for:

- public gateway fleets
- storage and artifact capture fleets
- signer and paymaster provider fleets

Use fleet repair for:

- storage fleets with due renewals or overdue local audits
- artifact fleets that need batch verification or anchoring catch-up
- mixed public/private deployment topologies

Use provider and lease-health reporting for:

- identifying weak storage, artifact, signer, or paymaster providers before they become operator incidents
- spotting leases that are expiring, overdue for audits, or under-replicated
- deciding which nodes need fleet repair before running a broad maintenance batch

Do not treat the fleet API as a general public dashboard. It is an operator
surface and should remain authenticated.
