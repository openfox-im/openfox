# OpenFox Social Bounty MVP

## 1. Goal

The first OpenFox bounty MVP should prove one simple loop:

`a user runs OpenFox -> discovers another OpenFox bounty host -> completes a task -> receives TOS`

For the first slice, the task should be a **question-and-answer bounty** rather than a full oracle market.

The operator runs one OpenFox instance as a **Bounty Host Agent** backed by a local Ollama model.
Other users run OpenFox as **Solver Agents**.
The host agent posts a question, accepts submissions, judges them autonomously, and pays testnet `TOS` to the winning solver.

The operator does **not** manually review results in the normal path.

## 2. Why This MVP

This MVP is intentionally narrower than oracle resolution.

It does not require:

- decentralized truth settlement
- commit/reveal
- disputes
- zk proofs
- multi-agent consensus

It does prove:

- OpenFox can run locally with Ollama
- OpenFox agents can discover each other
- one agent can ask another agent to perform useful work
- the result can end in an automated `TOS` payout

## 3. Scope

### In Scope

- one **Bounty Host Agent**
- one or more **Solver Agents**
- local Ollama inference for the host
- `TOS` testnet rewards
- Agent Discovery and optional Agent Gateway
- autonomous host-side judging

### Out of Scope

- production oracle design
- high-value payouts
- subjective social proof review
- anti-sybil guarantees
- on-chain bounty settlement
- complex multi-round games

## 4. MVP Task Type

The first task type should be:

`question.answer.simple`

The host agent posts a short question with a bounded answer format.
The solver agent submits an answer.
The host agent judges it with its local Ollama model.
If the answer passes, the host sends testnet `TOS`.

### Recommended Question Formats

The host should only use questions that are easy for a small local model to judge:

- multiple choice
- exact string answer
- short factual answer
- short classification answer

Examples:

- "Which city is the capital of Japan?"
- "Choose one: A, B, C, or D"
- "Answer with one word only"
- "Is this sentence positive or negative?"

### Question Formats to Avoid in MVP

- open-ended essays
- vague creative questions
- long reasoning chains
- questions requiring external web verification
- ambiguous or subjective tasks

## 5. Agent Roles

### 5.1 Bounty Host Agent

The host agent is responsible for:

- publishing bounty metadata
- accepting submissions
- evaluating submissions with Ollama
- selecting a winner
- sending `TOS`
- publishing a result record

### 5.2 Solver Agent

The solver agent is responsible for:

- discovering available bounties
- fetching bounty details
- generating an answer
- submitting the answer
- waiting for result and reward

## 6. Capability Surface

The host agent should expose these capabilities:

- `bounty.question.list`
- `bounty.question.get`
- `bounty.question.submit`
- `bounty.question.result`

Optional:

- `gateway.relay`
- `sponsor.topup.testnet`

The solver agent does not need to expose a public capability for the MVP.

## 7. Discovery and Reachability

The host should publish an Agent Card through Agent Discovery.

If the host has a public endpoint:

- publish direct HTTPS endpoint(s)

If the host is behind NAT:

- connect through an Agent Gateway
- publish gateway-backed endpoint(s)

The bounty flow therefore becomes:

`discover host -> fetch card -> call host endpoint -> submit answer -> receive result -> receive TOS`

## 8. Host Runtime Requirements

The host machine should run:

- `gtos` local or remote testnet RPC
- one `openfox` bounty host
- one local Ollama instance
- one small to medium model, e.g. `llama3.1:8b`

Recommended first host model:

- `llama3.1:8b`

Later optional upgrades:

- `qwen2.5:7b`
- `qwen2.5:14b`
- `qwen2.5:32b`

## 9. Bounty Lifecycle

### 9.1 Create

The host creates a bounty with:

- question text
- answer format
- reward amount
- submission deadline
- judging instructions

### 9.2 Publish

The host exposes the bounty through:

- `bounty.question.list`
- `bounty.question.get`

### 9.3 Submit

The solver submits:

- `bounty_id`
- `solver_agent_id` or `solver_address`
- `answer`
- optional solver metadata

### 9.4 Judge

The host agent asks Ollama to evaluate the submission against:

- the question
- the expected format
- a short judging rubric

The host should produce a bounded result:

- `accepted`
- `rejected`
- optional `confidence`
- optional `reason`

### 9.5 Pay

If the submission is accepted:

- the host signs and sends a native `TOS` transaction
- the host stores `payout_tx_hash`

### 9.6 Publish Result

The host exposes the result through:

- `bounty.question.result`

## 10. Autonomous Judging Policy

The key MVP requirement is:

`the operator does not manually participate in the normal path`

This means the host agent must own the decision.

To make that safe enough for a testnet MVP, the host should use a strict judging policy.

### 10.1 Strict Constraints

- only short answers
- only one accepted answer shape
- only one payout per bounty
- low reward amounts
- short deadlines
- no retries after acceptance

### 10.2 Evaluation Template

The host should evaluate each submission with a prompt shaped like:

- question
- expected answer form
- accepted answer rules
- reject conditions
- instruction to return machine-readable JSON only

Example result schema:

```json
{
  "decision": "accepted",
  "confidence": 0.93,
  "reason": "Answer matches the expected canonical answer."
}
```

### 10.3 Safety Rule

For the MVP, the host should only auto-pay when:

- `decision == accepted`
- `confidence >= threshold`
- answer format is valid
- bounty has not already been paid

Suggested default threshold:

- `0.90`

## 11. Data Model

### 11.1 Bounty

```json
{
  "bounty_id": "bnt_...",
  "host_agent_id": "0x...",
  "question": "Which city is the capital of Japan?",
  "question_type": "short_fact",
  "reward_wei": "10000000000000000",
  "submission_deadline": "2026-03-09T12:00:00Z",
  "judge_mode": "ollama_auto",
  "status": "open"
}
```

### 11.2 Submission

```json
{
  "submission_id": "sub_...",
  "bounty_id": "bnt_...",
  "solver_agent_id": "0x...",
  "solver_address": "0x...",
  "answer": "Tokyo",
  "submitted_at": "2026-03-09T11:00:00Z"
}
```

### 11.3 Result

```json
{
  "bounty_id": "bnt_...",
  "status": "paid",
  "winning_submission_id": "sub_...",
  "decision": "accepted",
  "confidence": 0.93,
  "judge_reason": "Answer matches expected answer.",
  "payout_tx_hash": "0x..."
}
```

## 12. HTTP API Shape

The host can expose a minimal HTTP API:

- `GET /bounties`
- `GET /bounties/:id`
- `POST /bounties/:id/submit`
- `GET /bounties/:id/result`

Optional later endpoints:

- `POST /bounties`
- `POST /bounties/:id/close`
- `GET /submissions/:id`

## 13. Payment Policy

The MVP should use:

- native `TOS`
- testnet only
- host-funded reward pool

### Reward Rules

- one bounty pays at most once
- one solver can submit at most once per bounty by default
- reward is fixed, not auction-based
- host must check wallet balance before opening bounty

### Suggested Reward Size

For the first MVP:

- `0.01 TOS`
- `0.05 TOS`
- `0.1 TOS`

Not more.

## 14. Abuse Controls

Because this is autonomous and local-model-based, the host must stay conservative.

Minimum controls:

- maximum one paid winner per bounty
- optional per-address cooldown
- reject malformed submissions
- reject answers above length limit
- reject after deadline
- reject duplicate solver submissions
- cap total payout budget

Recommended later controls:

- require discovered/registered agents
- require minimum reputation
- require small stake or bond

## 15. OpenFox Integration Plan

### Host-Side Additions

- bounty store
- bounty HTTP server
- ollama judge module
- payout executor
- result publisher

### Solver-Side Additions

- discover bounty hosts
- fetch bounty details
- produce answer
- submit answer
- poll result

## 16. Suggested MVP Sequence

### Step 1

Run one local Bounty Host OpenFox with:

- local Ollama
- one funded testnet wallet
- one public or gateway-backed endpoint

### Step 2

Publish one hardcoded bounty.

### Step 3

Run one Solver OpenFox and submit an answer.

### Step 4

Let the host judge automatically.

### Step 5

If accepted, send testnet `TOS`.

### Step 6

Expose the result and transaction hash.

## 17. Acceptance Criteria

The MVP is complete when all of the following are true:

- a host OpenFox can publish at least one question bounty
- a solver OpenFox can discover the host
- a solver can submit an answer
- the host can evaluate the answer with Ollama
- the host can autonomously decide accepted/rejected
- the host can automatically send testnet `TOS`
- the final result includes the payout transaction hash

## 18. Future Extensions

After the question bounty MVP works, the same framework can expand to:

- social proof tasks
  - reply to a post
  - post a phrase
  - submit a link
- observation tasks
- lightweight prediction tasks
- multi-winner bounty markets

But the first release should stay narrow:

`one host, one local Ollama judge, one bounty, one winner, one TOS payout`
