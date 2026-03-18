# OpenFox Bounty Implementation Plan

## 1. Purpose

This document turns the bounty architecture into an implementation plan.

It defines:

- what to build first
- which modules should own which behavior
- which files should be introduced
- how to phase delivery
- what counts as done

This plan assumes the architecture described in:

- [OpenFox-Bounty-Architecture.md](./OpenFox-Bounty-Architecture.md)

## 2. Delivery Goal

The first implementation goal is:

`one host OpenFox + one solver OpenFox + local Ollama + autonomous judging + testnet TOS payout`

This is not yet a generic marketplace.

It is a narrow but real bounty loop that proves:

- bounty publication
- discovery
- submission
- autonomous evaluation
- reward payment

## 3. Scope of the First Build

The first build should only support:

- one active bounty type:
  - `question-bounty`
- two roles:
  - `host`
  - `solver`
- one payout currency:
  - native `TOS`
- one judging mode:
  - local model auto-judge

Do not build in the first slice:

- multi-winner bounties
- manual review mode
- dispute mode
- multi-stage scoring
- on-chain bounty contracts
- large plugin systems

## 3.1 Why the First Skill Is a Question Bounty

The first skill is a question bounty only because it is the easiest bounded task to implement and test.

It gives the project:

- a simple host workflow
- a simple solver workflow
- a simple judge format
- a simple reward path

This should not be treated as the long-term definition of OpenFox bounty behavior.

The long-term reusable asset is the engine, not the question task itself.

## 3.2 How Future Tasks Should Expand

Once the engine exists, new tasks should mostly arrive as new skills.

Examples:

- `question-bounty-host`
- `question-bounty-solver`
- `social-proof-bounty-host`
- `social-proof-bounty-solver`
- `translation-bounty-host`
- `translation-bounty-solver`
- `observation-bounty-host`
- `observation-bounty-solver`

The host/solver behavior changes.
The engine should usually not.

## 3.3 Which Tasks Fit This Engine

Tasks that fit the bounty engine are tasks that look like:

- one host publishes one job
- one solver submits one result
- one evaluation happens
- zero or one payout happens

Good fits:

- question answering
- translation
- summarization
- short social proof tasks
- lightweight observation
- proof submission tasks

## 3.4 Which Tasks Need a Different Engine

Tasks that do not fit this engine well include:

- persistent assistants
- recurring workflows
- long-lived service agents
- continuous monitoring agents
- open-ended multi-step execution systems

Those should eventually use a separate task or workflow engine.

The bounty engine should not grow into a general-purpose agent orchestration layer.

## 4. Module Plan

## 4.1 Core Engine Modules

Create a new `src/bounty/` area.

Suggested files:

- `src/bounty/types.ts`
- `src/bounty/store.ts`
- `src/bounty/engine.ts`
- `src/bounty/http.ts`
- `src/bounty/payout.ts`
- `src/bounty/discovery.ts`
- `src/bounty/evaluate.ts`

Responsibilities:

### `types.ts`

Own all core bounty types:

- bounty record
- submission record
- result record
- role config
- judge result
- payout result

### `store.ts`

Own persistence:

- create bounty
- list bounties
- insert submission
- read submissions
- write result
- mark paid

### `engine.ts`

Own lifecycle transitions:

- open bounty
- accept submission
- reject invalid submission
- trigger evaluation
- finalize result
- trigger payout

### `http.ts`

Own the bounty HTTP surface:

- `GET /bounties`
- `GET /bounties/:id`
- `POST /bounties/:id/submit`
- `GET /bounties/:id/result`

### `payout.ts`

Own reward sending:

- check bounty reward amount
- check host balance
- send native `TOS`
- record `payout_tx_hash`

### `discovery.ts`

Own host-side discovery publication:

- publish bounty host capabilities
- publish bounty host endpoint metadata

### `evaluate.ts`

Own the bridge between the engine and the active skill:

- load evaluation skill
- provide normalized input
- parse normalized output
- return bounded judge result

## 4.2 Skill Modules

Add a small, explicit bounty skill area.

Suggested files:

- `src/bounty/skills/question-host.ts`
- `src/bounty/skills/question-solver.ts`

Responsibilities:

### `question-host.ts`

Should define:

- bounty creation prompt template
- answer evaluation rubric
- judge output schema

### `question-solver.ts`

Should define:

- how to read a question
- how to answer within the required format

Important rule:

These files should return structured instructions or structured judge output.
They should not own HTTP or payout logic.

## 4.3 Config Integration

Extend `OpenFoxConfig` with a bounty section.

Suggested additions:

- `enabled`
- `role`
- `skill`
- `bindHost`
- `port`
- `rewardWei`
- `autoPayConfidenceThreshold`
- `defaultSubmissionTtlSeconds`
- `maxOpenBounties`

Suggested files:

- `src/types.ts`
- `src/config.ts`

## 5. Database Plan

Add bounty tables to the local OpenFox database.

Suggested tables:

### `bounties`

Columns:

- `bounty_id`
- `host_agent_id`
- `question`
- `question_type`
- `reward_wei`
- `submission_deadline`
- `judge_mode`
- `status`
- `created_at`

### `bounty_submissions`

Columns:

- `submission_id`
- `bounty_id`
- `solver_agent_id`
- `solver_address`
- `answer`
- `submitted_at`
- `status`

### `bounty_results`

Columns:

- `bounty_id`
- `winning_submission_id`
- `decision`
- `confidence`
- `judge_reason`
- `payout_tx_hash`
- `created_at`

Suggested files:

- `src/state/schema.ts`
- `src/state/database.ts`

## 6. Host Flow Plan

### Step 1

Host starts with bounty mode enabled.

### Step 2

Host opens one or more question bounties.

### Step 3

Host publishes itself through Agent Discovery with bounty capabilities.

### Step 4

Host listens on the bounty HTTP API.

### Step 5

When a submission arrives:

- validate request shape
- reject duplicates
- reject after deadline
- persist submission

### Step 6

Trigger evaluation through the host bounty skill.

### Step 7

If accepted and above threshold:

- send native `TOS`
- record payout hash
- mark bounty paid

### Step 8

Expose final result through result endpoint.

## 7. Solver Flow Plan

### Step 1

Solver searches discovery for bounty host capabilities.

### Step 2

Solver selects one host.

### Step 3

Solver fetches available bounties.

### Step 4

Solver picks a bounty and generates an answer using the solver skill.

### Step 5

Solver submits the answer.

### Step 6

Solver polls result endpoint until:

- accepted
- rejected
- expired
- paid

## 8. Evaluation Design

The first evaluation implementation should be deliberately strict.

### Input to the judge

- bounty question
- question type
- expected answer format
- solver answer
- judging instructions

### Output from the judge

The engine should only accept a structured result:

```json
{
  "decision": "accepted",
  "confidence": 0.93,
  "reason": "The answer matches the expected canonical answer."
}
```

The parser should reject:

- invalid JSON
- missing `decision`
- confidence outside `[0, 1]`
- unsupported decision values

## 9. Payout Rules

The payout engine should enforce:

- one bounty can only pay once
- one submission cannot be paid twice
- payout only after accepted decision
- payout only if confidence exceeds threshold
- payout only if reward amount is within policy

Suggested first threshold:

- `0.90`

## 10. Discovery Plan

The host should publish these capabilities:

- `bounty.list`
- `bounty.get`
- `bounty.submit`
- `bounty.result`

If the host is behind NAT:

- route through Agent Gateway

If the host is public:

- publish direct HTTPS endpoint

## 11. Suggested File-Level Sequence

### Phase A: Data Layer

Build:

- `src/bounty/types.ts`
- bounty DB schema
- bounty DB helpers

Done when:

- bounties, submissions, and results can be inserted and loaded locally

### Phase B: Host Engine

Build:

- `src/bounty/engine.ts`
- `src/bounty/evaluate.ts`
- `src/bounty/payout.ts`

Done when:

- host can evaluate a stored submission and mark it accepted/rejected

### Phase C: HTTP Host Surface

Build:

- `src/bounty/http.ts`

Done when:

- host serves list/get/submit/result endpoints

### Phase D: Discovery Publication

Build:

- `src/bounty/discovery.ts`

Done when:

- host advertises bounty capabilities through Agent Discovery

### Phase E: Solver Flow

Build:

- solver discovery lookup
- bounty fetch
- answer submission
- result polling

Done when:

- a solver OpenFox can discover a host and submit an answer end-to-end

### Phase F: Skillization

Build:

- `question-host`
- `question-solver`

Done when:

- question bounty behavior is defined without hardcoding task logic into engine modules

### Phase G: Config Integration

Build:

- bounty config section
- host/solver role toggles

Done when:

- bounty mode is enabled entirely through config

## 12. Testing Plan

Minimum tests:

### Unit Tests

- bounty state transitions
- judge output validation
- payout policy checks
- duplicate submission rejection

### Integration Tests

- host opens bounty
- solver discovers host
- solver submits answer
- host evaluates submission
- host sends testnet `TOS`
- result endpoint returns payout hash

### Optional Later Tests

- gateway-backed host flow
- multiple solver submissions
- low-confidence rejection path

## 13. MVP Acceptance Criteria

The first implementation is complete when:

- one OpenFox host can publish one question bounty
- one OpenFox solver can discover that host
- the solver can submit an answer
- the host can judge autonomously with a local model
- the host can automatically send testnet `TOS`
- the result includes the payout transaction hash

## 14. Post-MVP Extensions

Once the first slice works, the same engine can be reused for:

- social proof bounties
- translation bounties
- observation bounties
- lightweight prediction bounties

At that point, most new work should happen in:

- new skills
- new config profiles

not in the engine itself.

## 15. Expansion Rule

Use this decision rule:

- if the task is "publish once, submit once, judge once, pay once", extend the bounty engine with a new skill
- if the task is "run continuously, coordinate repeatedly, or provide an open-ended service", build a different engine

This keeps OpenFox extensible without turning one MVP into a permanent code pattern for everything.
