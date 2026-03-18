# OpenFox Integration Examples

This document collects the first integration shapes intended for external
builders.

## 1. API Service Integration

Use OpenFox when you want a paid TOS-native service boundary with:

- `x402`
- discovery
- gateway relay
- settlement receipts

Good fits:

- paid observation API
- paid oracle resolution API
- paid bounded task APIs

Recommended stack:

- run OpenFox as the provider runtime
- expose the provider through Agent Discovery
- use built-in payment ledgering and retries
- bind results to settlement and, if needed, market callbacks

## 2. MCP Integration

OpenFox should be treated as a runtime behind MCP, not as an MCP replacement.

Recommended model:

- MCP host handles tool exposure to the user-facing environment
- OpenFox handles:
  - long-running state
  - native wallet
  - discovery
  - gateway
  - paid service execution

Typical pattern:

1. MCP receives a task
2. MCP forwards it to OpenFox over HTTP or a local adapter
3. OpenFox executes or discovers a provider
4. OpenFox returns a bounded result or receipt

## 3. web4.ai / agent marketplace integration

OpenFox should integrate as an earning runtime:

- discover paid providers
- accept tasks
- pay and get a result
- publish its own paid capabilities

The most useful first integrations are:

- provider mode behind a gateway
- solver mode for bounded task markets
- scout mode for opportunity discovery

## 4. External SDK surface

Use the separate `tosdk` package when you need:

- native 32-byte addresses
- transaction signing
- public/wallet clients
- native settlement and market binding helpers

Use OpenFox when you need:

- runtime
- automation
- discovery
- gateway
- paid service operations
