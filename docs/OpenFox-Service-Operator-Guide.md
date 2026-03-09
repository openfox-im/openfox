# OpenFox Service Operator Guide

This guide documents how to operate OpenFox in the three main service roles:

- requester
- provider
- gateway

It assumes the protocol line already exists:

- Agent Discovery
- Agent Gateway
- TOS-native wallet and payment path

The goal here is operator ergonomics: deployment shape, health checks, and
troubleshooting.

## 1. Operator Commands

OpenFox now exposes a small operator surface for service mode:

```bash
openfox service status
openfox service check
openfox service install
openfox service restart
openfox service uninstall
openfox gateway status
openfox gateway bootnodes
openfox gateway check
```

These commands are read-only unless you are also editing runtime config with the
other setup/config commands.

What they answer:

- `service status`
  - what roles this config implies
  - which provider routes are expected
  - whether gateway client/server mode is enabled
  - whether cached gateway session state exists
- `service check`
  - whether local provider health endpoints respond
  - whether the configured chain RPC responds
  - whether the configured gateway health endpoint responds
- `service install/start/stop/restart/uninstall`
  - whether OpenFox should run as a managed Linux user service
  - whether the service is enabled and active under systemd
- `gateway status`
  - gateway server mode
  - gateway client mode
  - payment direction
  - route/session limits
  - whether a signed bootnode list is present
- `gateway bootnodes`
  - whether the signed list verifies
  - which bootnodes are currently trusted

## 2. Role Model

### 2.1 Requester

A requester does not need to expose a public endpoint.

It mainly needs:

- `agentDiscovery.enabled = true`
- `rpcUrl`
- `chainId`
- an inference backend

Typical requester behavior:

- discover capability providers
- choose a provider by policy
- pay when required
- call the provider

### 2.2 Provider

A provider exposes one or more capabilities.

Examples already built into OpenFox:

- `sponsor.topup.testnet`
- `observation.once`

The built-in observation provider now exposes a stable paid service surface:

- `POST /observe`
- `GET /jobs/:id`

A provider may be:

- directly reachable on a public IP
- reachable on a LAN
- hidden behind NAT and published via a gateway

### 2.3 Gateway

A gateway is a public relay for providers that cannot accept inbound traffic.

It needs:

- public reachability
- `agentDiscovery.gatewayServer.enabled = true`
- a stable public base URL
- a TOS wallet if relay payment is enabled

## 3. Deployment Modes

## 3.1 Local-only

Use this during development.

Typical shape:

- one local OpenFox runtime
- local chain RPC
- local provider endpoints
- no public gateway

Useful for:

- testing skills
- testing bounty host/solver flows
- testing provider logic without exposure

## 3.2 LAN / Private Mesh

Use this when all participants are on the same reachable network, such as:

- a home lab
- office LAN
- Tailscale or WireGuard mesh

In this mode:

- provider endpoints may use private IPs
- gateway may be optional
- discovery still works as usual

## 3.3 Public Provider

Use this when the provider itself has a public IP or reverse proxy.

Typical shape:

- provider server listens locally
- public reverse proxy terminates TLS
- Agent Card publishes the public HTTPS endpoint

## 3.4 NAT Provider + Public Gateway

This is the main gateway use case.

Typical shape:

- provider runs on a private machine
- provider opens outbound session to a public gateway
- gateway allocates public relay URL
- requester uses the relay URL, not the private address

This is the preferred pattern when the provider does not control a public IP.

## 4. Minimal Config Shapes

## 4.1 Requester

```json
{
  "rpcUrl": "http://127.0.0.1:8545",
  "chainId": 1666,
  "agentDiscovery": {
    "enabled": true,
    "publishCard": false
  }
}
```

## 4.2 Provider

```json
{
  "rpcUrl": "http://127.0.0.1:8545",
  "chainId": 1666,
  "agentDiscovery": {
    "enabled": true,
    "publishCard": true,
    "faucetServer": {
      "enabled": true,
      "bindHost": "127.0.0.1",
      "port": 4877,
      "path": "/agent-discovery/faucet",
      "capability": "sponsor.topup.testnet",
      "payoutAmountWei": "10000000000000000",
      "maxAmountWei": "10000000000000000",
      "cooldownSeconds": 86400,
      "requireNativeIdentity": true
    }
  }
}
```

## 4.3 Gateway

```json
{
  "rpcUrl": "http://127.0.0.1:8545",
  "chainId": 1666,
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
      "mode": "paid",
      "paymentDirection": "requester_pays",
      "sessionTtlSeconds": 3600,
      "requestTimeoutMs": 5000,
      "maxRoutesPerSession": 8,
      "maxRequestBodyBytes": 131072
    }
  }
}
```

## 5. Health Checks

OpenFox uses simple HTTP health probes for service mode.

### 5.1 Provider Health

Built-in provider servers expose:

- faucet: `<path>/healthz`
- observation: `<path>/healthz`

### 5.2 Gateway Health

Gateway server exposes:

- `<publicPathPrefix>/healthz`

### 5.3 Chain Health

`openfox service check` also probes:

- `rpcUrl` via `tos_chainId`

## 6. Typical Operator Flow

### 6.0 Managed Service Install (Linux user-systemd)

If you want OpenFox to stay up in the background without a terminal session,
install it as a managed user service:

```bash
openfox service install
openfox service status
```

This writes a user unit at:

- `~/.config/systemd/user/openfox.service`

and logs to:

- `~/.openfox/openfox-service.log`

Useful follow-up commands:

```bash
openfox service restart
openfox service stop
openfox service start
openfox service uninstall
```

The current implementation targets Linux user-systemd first. Other service
managers can be added later without changing the OpenFox runtime model.

### 6.1 Requester

```bash
openfox service status
openfox service check
openfox --run
```

### 6.2 Provider

```bash
openfox service status
openfox service check
openfox cron list
openfox --run
```

### 6.3 Gateway

```bash
openfox gateway status
openfox gateway bootnodes
openfox gateway check
openfox --run
```

## 7. Troubleshooting

## 7.1 `service check` shows RPC failure

Check:

- `rpcUrl`
- local node availability
- `chainId`

## 7.2 Provider route exists but is not reachable

Check:

- local bind host and port
- provider health endpoint
- whether the route is published directly or only through a gateway

## 7.3 Gateway server is configured but requesters cannot reach it

Check:

- public DNS
- reverse proxy
- TLS
- `publicBaseUrl`
- `publicPathPrefix`

## 7.4 Gateway client is configured but no session is established

Check:

- bootnode list validity
- signed bootnode requirement
- whether the target gateway is reachable over WSS
- whether provider routes are configured

## 7.5 Signed bootnode list fails verification

Check:

- `networkId`
- signer address
- signature freshness and distribution process

## 8. Operational Boundary

OpenFox now has:

- service role inspection
- health checks
- gateway bootnode verification
- gateway config/status inspection

It still does not try to be a full deployment platform. Process supervision,
systemd, containers, reverse proxies, and TLS termination should still be
managed by the operator's environment.
