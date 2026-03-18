## 2046 Architecture Modules

- `src/intent/` — Intent lifecycle (types, state machines, store, explain,
  escalation, policy presets, bridge to signer/paymaster)
- `src/terminal/` — Terminal adapters (app, card, POS, voice, kiosk, robot),
  registry, degraded mode, recovery/public terminal flows
- `src/terminal/hardware/` — Hardware abstractions (NFC, POS device, Voice I/O)
  with mock implementations for testing
- `src/sponsor/` — Sponsor discovery, quote ranking, attribution tracking
- `src/audit/` — Append-only audit journal, report generation, replay
  inspection, proof display
- `src/routing/` — Discovery-native financial router with multi-factor scoring
- `src/pipeline/` — End-to-end intent execution pipeline (executor, factory)
- `src/commands/intent.ts` — CLI: intent transfer/status/list/explain/replay/quotes
- `src/commands/terminal.ts` — CLI: terminal list/sessions/revoke/policy
- `src/commands/audit.ts` — CLI: audit journal/report/proofs
- `src/commands/policy.ts` — CLI: policy list/show/simulate/create/explain/diff/validate
- `src/policy/` — Policy authoring, simulation, and templates by account type
  and trust tier (authoring.ts, simulation.ts, templates.ts)
- `src/agent/intent-tools.ts` — Agent tools for intent pipeline

Schema version `0.1.0` in `src/intent/types.ts`. DB schema version in
`src/state/schema.ts` (currently v50).
