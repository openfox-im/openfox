# OpenFox MetaWorld Reactor Design

## 1. Problem

MetaWorld v2 delivered all the economic components: governance, treasury,
intents, reputation, federation, chain anchoring, and real-time push
infrastructure.

However, these components are **isolated modules that do not trigger one
another**. Every step in the economic flow requires manual CLI invocation. There
is no automatic cascade from intent completion to settlement, from settlement
to reputation, or from any state change to the event bus.

The "Day in MetaWorld" vision — where opportunities flow from discovery through
matching, execution, settlement, anchoring, reputation, and federation — does
not work as an end-to-end pipeline today.

## 2. Root Cause

The modules were built bottom-up with clean APIs but no integration layer:

```
intents.ts  ──✘──  governance.ts  ──✘──  treasury.ts  ──✘──  chain-anchor.ts
                                                                    ✘
event-bus.ts  ──✘──  reputation.ts  ──✘──  federation.ts
```

They do not import one another. They do not call one another. The
`worldEventBus.publish()` method is never called anywhere in the codebase.

## 3. Design Principle: Protocol vs Participant

The orchestration layer must respect a fundamental distinction:

**Protocol rules** are deterministic consequences of state changes. They do not
require intelligence. They must always happen.

**Participant decisions** are economic choices made by Foxes. They require
judgment. They should not be hardcoded.

| Layer | Nature | Examples |
| --- | --- | --- |
| Reactor (protocol) | Deterministic | Vote reaches quorum → auto-resolve proposal. Settlement completes → emit reputation event. Any state change → publish to event bus. Budget period expires → reset spent counter. |
| Agent skills (participant) | AI-driven | Discover opportunity → decide whether to publish intent. See open intent → decide whether to respond. Receive artifact → decide whether to approve quality. Proposal passes → decide when to execute spend. |

The reactor is the protocol. The agent is the participant. The protocol does
not need intelligence. The participant does.

## 4. Architecture

### 4.1 Reactor: Deterministic Consequence Engine

File: `src/metaworld/reactor.ts`

The reactor listens to state changes within the existing modules and fires
deterministic consequences. It does not make decisions. It enforces invariants
and propagates effects.

```
┌────────────────────────────────────────────────────────────────┐
│  Reactor (src/metaworld/reactor.ts)                            │
│                                                                │
│  Hooks into:              Fires:                               │
│  ─────────────            ──────                               │
│  governance vote cast  →  resolve proposal if quorum met       │
│  proposal approved     →  mark as ready for execution          │
│  proposal executed     →  worldEventBus.publish(proposal.update)│
│  intent status change  →  worldEventBus.publish(intent.update) │
│  intent completed      →  emit reputation events for solver    │
│  intent completed      →  create settlement spend proposal     │
│  treasury spend done   →  worldEventBus.publish(treasury.update)│
│  treasury spend done   →  emit reputation event (economic)     │
│  settlement completed  →  queue chain anchor commitment        │
│  reputation changed    →  worldEventBus.publish(reputation.update)│
│  any replicable event  →  queue federation broadcast           │
│  budget period expired →  reset spent counters (heartbeat)     │
│  stale proposals       →  expire them (heartbeat)              │
└────────────────────────────────────────────────────────────────┘
```

### 4.2 Agent Skills: Economic Decision Layer

The agent skills remain in the existing agent loop and skill system. They
observe world state — including reactor-produced events — and make decisions:

```
┌────────────────────────────────────────────────────────────────┐
│  Agent Skills (agent loop / src/skills/)                        │
│                                                                │
│  Observes:                Decides:                             │
│  ──────────               ────────                             │
│  opportunity surfaced  →  publish intent? at what price?       │
│  open intent found     →  respond? with what proposal?        │
│  artifact submitted    →  approve quality? request revision?  │
│  spend proposal ready  →  execute now? wait for better rate?  │
│  vote requested        →  approve or reject? why?             │
│  federation peer event →  trust this attestation?             │
└────────────────────────────────────────────────────────────────┘
```

### 4.3 How They Compose

```
Agent observes opportunity
  → Agent decides to create intent (skill decision)
    → Reactor publishes intent.update event
      → SSE delivers to web shell in real time

Solver agent sees intent via feed
  → Solver decides to respond (skill decision)
    → Reactor publishes intent.update event

Publisher agent reviews artifact
  → Publisher decides to approve (skill decision)
    → Reactor auto-creates settlement spend proposal
    → Reactor emits reputation event for solver
    → Reactor publishes intent.update, reputation.update events

Group members vote on spend proposal
  → Reactor auto-resolves when quorum + threshold met
    → Reactor publishes proposal.update event

Executor agent sees approved proposal
  → Executor decides to execute spend (skill decision)
    → Reactor records treasury outflow
    → Reactor emits economic reputation event
    → Reactor publishes treasury.update event
    → Reactor queues chain anchor commitment
    → Reactor queues federation broadcast
```

## 5. Reactor Implementation

### 5.1 Core Interface

```typescript
// src/metaworld/reactor.ts

interface ReactorContext {
  db: OpenFoxDatabase;
  config: OpenFoxConfig;
  eventBus: WorldEventBus;
}

// Called after any governance vote is cast
function onGovernanceVoteCast(ctx: ReactorContext, params: {
  groupId: string;
  proposalId: string;
}): void

// Called after a proposal is resolved (approved/rejected/expired)
function onProposalResolved(ctx: ReactorContext, params: {
  groupId: string;
  proposalId: string;
  outcome: "approved" | "rejected" | "expired";
}): void

// Called after a proposal is executed
function onProposalExecuted(ctx: ReactorContext, params: {
  groupId: string;
  proposalId: string;
  proposalType: string;
  result: Record<string, unknown>;
}): void

// Called after an intent status changes
function onIntentStatusChanged(ctx: ReactorContext, params: {
  intentId: string;
  previousStatus: string;
  newStatus: string;
  groupId?: string;
}): void

// Called after an intent is completed and approved
function onIntentCompleted(ctx: ReactorContext, params: {
  intentId: string;
  publisherAddress: string;
  solverAddress: string;
  groupId?: string;
  budgetWei?: string;
}): void

// Called after a treasury spend is executed
function onTreasurySpendExecuted(ctx: ReactorContext, params: {
  groupId: string;
  recipient: string;
  amountWei: string;
  txHash?: string;
  proposalId?: string;
}): void

// Called after a settlement is recorded
function onSettlementRecorded(ctx: ReactorContext, params: {
  groupId?: string;
  settlementId: string;
  parties: string[];
}): void

// Heartbeat-driven periodic reactor tasks
function runReactorHeartbeat(ctx: ReactorContext): void
```

### 5.2 Event Bus Integration Points

Every reactor function calls `ctx.eventBus.publish()` at the appropriate
moment. This is the single integration point that wires all modules to the
real-time push infrastructure.

| Reactor Function | Event Kind | Payload |
| --- | --- | --- |
| `onGovernanceVoteCast` | `proposal.update` | `{ groupId, proposalId, action: "vote_cast" }` |
| `onProposalResolved` | `proposal.update` | `{ groupId, proposalId, outcome }` |
| `onProposalExecuted` | `proposal.update` | `{ groupId, proposalId, action: "executed" }` |
| `onIntentStatusChanged` | `intent.update` | `{ intentId, previousStatus, newStatus }` |
| `onIntentCompleted` | `intent.update` | `{ intentId, action: "completed" }` |
| `onIntentCompleted` | `reputation.update` | `{ address: solverAddress, source: "intent_completion" }` |
| `onTreasurySpendExecuted` | `treasury.update` | `{ groupId, recipient, amountWei }` |
| `onTreasurySpendExecuted` | `reputation.update` | `{ address: recipient, source: "settlement" }` |
| `onSettlementRecorded` | `feed.item` | `{ type: "settlement_completed", settlementId }` |

### 5.3 Cross-Module Wiring

The reactor is the only place where cross-module calls happen:

| Trigger | Reactor Action | Target Module |
| --- | --- | --- |
| Intent completed with budget | Create `spend` governance proposal | `governance.ts` |
| Intent completed | Emit `intent_completion` reputation event | `reputation.ts` |
| Treasury spend executed | Emit `settlement` reputation event | `reputation.ts` |
| Settlement recorded | Queue state commitment | `chain-anchor.ts` |
| Any world-relevant event | Queue federation broadcast | `federation.ts` |

### 5.4 Integration Into Existing Code

The reactor does not replace existing module APIs. It wraps them with
after-hooks. The integration pattern is:

**Option A: Call-site integration**

Each existing function gains an optional `reactor` parameter. When provided,
the function calls the appropriate reactor hook after its own logic completes.

```typescript
// In intents.ts
function approveIntentCompletion(params: {
  db: OpenFoxDatabase;
  intentId: string;
  approverAddress: string;
  reactor?: ReactorContext;  // new optional parameter
}): { ... } {
  // ... existing logic ...
  const result = /* existing completion logic */;

  if (params.reactor) {
    onIntentCompleted(params.reactor, {
      intentId: params.intentId,
      publisherAddress: result.publisherAddress,
      solverAddress: result.solverAddress,
      groupId: result.groupId,
      budgetWei: result.budgetWei,
    });
  }

  return result;
}
```

**Option B: Centralized call-through (preferred)**

The reactor exports high-level orchestrated operations that call the underlying
module functions and then fire consequences. CLI commands and agent skills call
the reactor instead of calling module functions directly.

```typescript
// In reactor.ts
async function completeIntent(ctx: ReactorContext, params: {
  intentId: string;
  approverAddress: string;
}): Promise<IntentCompletionResult> {
  // Step 1: call intents.ts
  const result = approveIntentCompletion({ db: ctx.db, ...params });

  // Step 2: deterministic consequences
  onIntentCompleted(ctx, {
    intentId: params.intentId,
    publisherAddress: result.publisherAddress,
    solverAddress: result.solverAddress,
    groupId: result.groupId,
    budgetWei: result.budgetWei,
  });

  return result;
}
```

Option B is preferred because it keeps the existing module functions pure and
testable while concentrating all cross-module wiring in one file.

### 5.5 Heartbeat Integration

Add reactor heartbeat tasks to the existing heartbeat system:

```typescript
// Called by the existing heartbeat daemon
function runReactorHeartbeat(ctx: ReactorContext): void {
  // 1. Expire stale governance proposals
  expireStaleProposals({ db: ctx.db });

  // 2. Reset expired budget periods
  resetExpiredBudgetPeriods({ db: ctx.db });

  // 3. Sync treasury balances from on-chain
  syncTreasuryBalance({ db: ctx.db, rpcUrl: ctx.config.rpcUrl });

  // 4. Run federation sync cycle
  runWorldFederationSync({ db: ctx.db });

  // 5. Publish periodic chain state commitments for anchored Groups
  publishPendingChainCommitments({ db: ctx.db });
}
```

## 6. Implementation Plan

### 6.1 Task 119: MetaWorld Reactor — Event Bus Wiring

Wire `worldEventBus.publish()` calls into all existing state-changing
operations so the real-time push infrastructure becomes functional.

Scope:

- Add `worldEventBus.publish()` calls at every state change point in
  governance, treasury, intents, reputation, and messaging
- Verify SSE endpoint delivers events to connected clients
- Verify web shell receives and renders real-time updates
- Test: `src/__tests__/reactor-events.test.ts`

### 6.2 Task 120: MetaWorld Reactor — Cross-Module Consequences

Implement the reactor core that fires deterministic consequences when state
changes occur.

Scope:

- `src/metaworld/reactor.ts` — reactor context, hook functions, orchestrated
  operations
- Intent completed → auto-create settlement spend proposal in governance
- Intent completed → emit reputation events for solver and publisher
- Treasury spend executed → emit economic reputation events
- Settlement recorded → queue chain anchor commitment
- Governance vote cast → auto-resolve if quorum + threshold met
- Test: `src/__tests__/reactor-consequences.test.ts`

### 6.3 Task 121: MetaWorld Reactor — Heartbeat Automation

Connect the reactor's periodic tasks to the heartbeat daemon so time-driven
operations run automatically.

Scope:

- Add reactor heartbeat function to the existing heartbeat task registry
- Expire stale governance proposals on schedule
- Reset expired budget periods on schedule
- Sync treasury balances from on-chain on schedule
- Run federation sync cycle on schedule
- Publish pending chain state commitments on schedule
- Test: `src/__tests__/reactor-heartbeat.test.ts`

### 6.4 Task 122: MetaWorld Reactor — Federation Broadcasting

Connect local state changes to federation outbound broadcasting so other nodes
receive world events automatically.

Scope:

- Local reputation events → federation broadcast queue
- Local intent lifecycle events → federation broadcast queue
- Local settlement events → federation broadcast queue
- Heartbeat-driven federation outbound flush
- Test: `src/__tests__/reactor-federation.test.ts`

### 6.5 Task 123: MetaWorld Agent Skills — Economic Decision Layer

Add agent skills that observe reactor-produced events and make economic
decisions through the agent loop.

Scope:

- Skill: observe opportunities and decide whether to publish intents
- Skill: observe open intents and decide whether to respond
- Skill: observe submitted artifacts and decide whether to approve
- Skill: observe approved spend proposals and decide whether to execute
- Skill: observe vote requests and decide voting stance
- Integration with agent system prompt for economic reasoning
- Test: `src/__tests__/agent-economic-skills.test.ts`

## 7. Ordering

Tasks 119-122 form the reactor layer and should be implemented in order.
Task 123 (agent skills) depends on the reactor being functional and can follow
after.

```
Task 119 (event bus wiring)
  → Task 120 (cross-module consequences)
    → Task 121 (heartbeat automation)
      → Task 122 (federation broadcasting)
        → Task 123 (agent economic skills)
```

## 8. What This Does NOT Change

- Existing module APIs remain unchanged and independently testable
- Existing CLI commands continue to work (they gain reactor integration)
- Existing web shell routes and JSON APIs remain unchanged
- Existing Group sync protocol remains unchanged
- No schema changes required
- No new dependencies

## 9. Success Criteria

When the reactor is complete:

1. A user completes an intent → a spend proposal automatically appears in
   Group governance
2. A spend proposal reaches quorum → it auto-resolves without manual
   intervention
3. A treasury spend is executed → reputation events are emitted and scores
   update
4. Any state change → the web shell updates in real time via SSE
5. Any world-relevant event → federation peers receive it in the next sync
   cycle
6. Chain state commitments are published automatically on schedule

When agent skills are added:

7. A Fox autonomously discovers opportunities, evaluates them, and publishes
   intents
8. A solver Fox autonomously finds matching intents and submits proposals
9. A Fox autonomously reviews artifacts and makes approval decisions
10. The full "Day in MetaWorld" flow runs with minimal human intervention
