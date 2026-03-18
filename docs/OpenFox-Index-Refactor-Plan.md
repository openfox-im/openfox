# Plan: Refactor `src/index.ts` (7413 lines) into Modular Architecture

## Problem

`src/index.ts` is a 7400+ line monolith containing 30+ CLI command handlers, the agent runtime loop, 12+ server startup sequences, and utility functions. As a reference, upstream OpenClaw keeps `index.ts` at 93 lines — pure entry point with all logic delegated to modules.

## Target

Split into ~20 focused modules. Each file under 500 lines. `index.ts` reduced to ~100 lines (imports + CLI dispatch + entry point).

## Directory Structure

```
src/
  index.ts                          # ~100 lines: env setup, CLI dispatch, entry
  cli/
    parse.ts                        # readOption, readFlag, readNumberOption, etc.
    dispatch.ts                     # main() command router (switch/case dispatch)
  commands/
    heartbeat.ts                    # handleHeartbeatCommand
    cron.ts                         # handleCronCommand
    service.ts                      # handleServiceCommand
    gateway.ts                      # handleGatewayCommand
    autopilot.ts                    # handleAutopilotCommand
    fleet.ts                        # handleFleetCommand
    dashboard.ts                    # handleDashboardCommand
    health.ts                       # handleHealthCommand, handleDoctorCommand, handleModelsCommand
    onboard.ts                      # handleOnboardCommand
    finance.ts                      # handleFinanceCommand
    report.ts                       # handleReportCommand
    templates.ts                    # handleTemplatesCommand
    packs.ts                        # handlePacksCommand
    logs.ts                         # handleLogsCommand
    campaign.ts                     # handleCampaignCommand
    bounty.ts                       # handleBountyCommand
    settlement.ts                   # handleSettlementCommand
    market.ts                       # handleMarketCommand
    payments.ts                     # handlePaymentsCommand
    scout.ts                        # handleScoutCommand
    strategy.ts                     # handleStrategyCommand
    storage.ts                      # handleStorageCommand
    providers.ts                    # handleProvidersCommand
    artifacts.ts                    # handleArtifactCommand
    evidence.ts                     # handleEvidenceCommand
    oracle.ts                       # handleOracleCommand
    news.ts                         # handleNewsCommand
    proof.ts                        # handleProofCommand
    committee.ts                    # handleCommitteeCommand
    group.ts                        # handleGroupCommand
    trails.ts                       # handleTrailsCommand
    signer.ts                       # handleSignerCommand
    paymaster.ts                    # handlePaymasterCommand
    status.ts                       # showStatus
  runtime/
    run.ts                          # run() — full runtime init + server startups
    agent-loop.ts                   # main agent loop (wake/sleep/think cycle)
    inference-factory.ts            # createConfiguredInferenceClient, NoopInferenceClient
    heartbeat-context.ts            # withHeartbeatContext, runHeartbeatTaskNow
    record-transformers.ts          # toPaymasterQuoteRecord, toPaymasterAuthorizationRecord
```

## Phase Plan

### Phase 1: Extract CLI Utilities (low risk)

Move lines 894-1038 to `src/cli/parse.ts`:
- `readOption`, `readNumberOption`, `collectRepeatedOption`, `readCsvOption`
- `readFlag`, `readGroupIdArg`, `readGroupVisibilityOption`, `readGroupJoinModeOption`
- `parseGroupChannelSpecs`, `readSignerTrustTierOption`
- `resolveSignerProviderBaseUrl`, `resolvePaymasterProviderBaseUrl`

All callers already receive `args: string[]` — pure functions, zero coupling.

**Estimated size:** ~150 lines
**Risk:** None

### Phase 2: Extract Runtime Utilities (low risk)

Move to `src/runtime/`:
- `inference-factory.ts` — `NoopInferenceClient`, `createConfiguredInferenceClient`, `hasConfiguredInferenceProvider` (lines 347-430, 7383-7406)
- `heartbeat-context.ts` — `withHeartbeatContext`, `runHeartbeatTaskNow` (lines 1188-1266)
- `record-transformers.ts` — `toPaymasterQuoteRecord`, `toPaymasterAuthorizationRecord` (lines 1085-1186)

**Estimated size:** ~80 + ~80 + ~100 lines
**Risk:** None

### Phase 3: Extract Command Handlers (medium risk, biggest win)

Each `handleXxxCommand()` is a self-contained function taking `(args, config, db)` or similar. Extract one-by-one, largest first:

| Priority | Command | Lines | Source range |
|----------|---------|-------|-------------|
| 1 | group | 644 | 4958-5601 |
| 2 | run (runtime) | 886 | 6203-7089 |
| 3 | report | 470 | 2304-2773 |
| 4 | fleet | 336 | 1748-2083 |
| 5 | bounty | 207 | 3093-3299 |
| 6 | artifacts | 285 | 4147-4431 |
| 7 | committee | 167 | 4790-4956 |
| 8 | storage | 237 | 3851-4087 |
| 9 | paymaster | 268 | 5903-6170 |
| 10 | signer | 227 | 5675-5901 |
| 11 | payments | 146 | 3559-3704 |
| 12 | evidence | 155 | 4433-4587 |
| 13 | cron | 135 | 1345-1479 |
| 14 | campaign | 139 | 2953-3091 |
| 15-30 | remaining | <100 each | — |

Each extraction follows the pattern:
```ts
// src/commands/group.ts
import { readOption, readGroupIdArg } from "../cli/parse.js";
// ... other imports

export async function handleGroupCommand(args: string[], ...): Promise<void> {
  // moved verbatim from index.ts
}
```

```ts
// src/index.ts (after all extractions)
import { handleGroupCommand } from "./commands/group.js";
// ... in switch/case:
case "group": return handleGroupCommand(args, config, db, ...);
```

**Risk:** Medium — need to identify the closure variables each handler captures. Most handlers need `config`, `db`, and a few resolved utilities. Define a shared `CommandContext` interface:

```ts
export interface CommandContext {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  rawDb: DatabaseType;
  identity: IdentityInfo;
  walletAccount: () => Promise<Account>;
  inferenceClient: () => InferenceClient;
}
```

### Phase 4: Extract Runtime Init & Agent Loop (medium risk)

Move `run()` (lines 6203-7089) to `src/runtime/run.ts` and agent loop (lines 7295-7380) to `src/runtime/agent-loop.ts`.

The `run()` function initializes 12+ servers and passes handles into the agent loop. Extract as-is; the function signature stays clean:

```ts
// src/runtime/run.ts
export async function run(config: OpenFoxConfig): Promise<void> { ... }
```

**Estimated size:** ~900 + ~100 lines. The `run.ts` is still large but self-contained; can be split further later into `src/runtime/servers/` if needed.

**Risk:** Medium — graceful shutdown signal handlers capture server references. Keep shutdown logic co-located with startup.

### Phase 5: Slim Down `index.ts` to Entry Point

After all extractions, `index.ts` becomes:

```ts
#!/usr/bin/env node
import { loadConfig, resolvePath } from "./config.js";
import { StructuredLogger } from "./observability/logger.js";
import { prettySink } from "./observability/pretty-sink.js";
import { dispatch } from "./cli/dispatch.js";
import { run } from "./runtime/run.js";

const args = process.argv.slice(2);
const command = args[0];

if (command === "--run") {
  StructuredLogger.setSink(prettySink);
  await run();
} else {
  await dispatch(args);
}
```

**Estimated size:** ~100 lines (including re-exports for package API)

## Execution Order

```
Phase 1 (cli/parse.ts)           → commit, test
Phase 2 (runtime utilities)      → commit, test
Phase 3 (command handlers, 5/batch) → commit per batch, test
Phase 4 (runtime/run.ts)         → commit, test
Phase 5 (slim index.ts)          → commit, test
```

Total: ~8-10 commits. Each phase is independently testable — no phase depends on a later one.

## Validation

After each phase:
1. `pnpm run typecheck`
2. `pnpm run build`
3. `pnpm run test` (all 1779 tests pass)
4. `grep -c 'function\|export' src/index.ts` — line count trending down

## Notes

- **No behavior changes.** Pure refactor — move code, update imports.
- **No new abstractions.** Each handler moves verbatim. Abstraction (`CommandContext`, shared patterns) is a follow-up.
- **`src/commands/wallet.ts` already exists** in the CLI package (`packages/cli/src/commands/`). The new `src/commands/` is for the core runtime's command handlers, not the CLI package.
- **Existing `src/runtime/x402.ts`** already lives in `src/runtime/`. New runtime files join it naturally.
