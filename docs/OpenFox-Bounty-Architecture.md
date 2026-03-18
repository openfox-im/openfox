# OpenFox Bounty Architecture

## 1. Purpose

OpenFox should not require a core code change for every new bounty MVP.

Instead, bounty functionality should be split into three layers:

- a stable **Core Bounty Engine**
- a flexible **Skill Layer**
- a deployment-focused **Config Layer**

This allows OpenFox to support multiple bounty styles without repeatedly changing the main runtime.

## 2. Design Goal

The design goal is:

`build the bounty mechanics once, change the bounty behavior through skills and config`

In practice:

- the runtime should know how to open bounties, accept submissions, judge outcomes, and pay rewards
- the runtime should not hardcode the business logic for every bounty type
- changing from a question bounty to a social proof bounty should mostly mean changing a skill and configuration, not rewriting the runtime

## 3. Layer Overview

### 3.1 Core Bounty Engine

The Core Bounty Engine is the stable infrastructure layer.

It is responsible for:

- bounty lifecycle management
- submission intake
- result storage
- payout execution
- discovery publication
- safety checks
- endpoint handling

It should not care whether a bounty is:

- a question-answer task
- a social proof task
- a translation task
- an observation task

It only cares about states, records, and reward execution.

### 3.2 Skill Layer

The Skill Layer defines bounty-specific behavior.

It is responsible for:

- what kind of task is being posted
- how a solver should approach the task
- how the host should judge a submission
- what acceptance criteria apply
- how to explain the task to the model

The skill is where bounty-specific logic lives.

### 3.3 Config Layer

The Config Layer determines how a particular deployment behaves.

It is responsible for:

- whether bounty mode is enabled
- whether this OpenFox instance is a host or a solver
- which skill is active
- reward size
- payout limits
- confidence threshold
- submission deadlines
- model/backend selection

This makes deployment behavior adjustable without changing code.

## 4. Core Bounty Engine

The engine should provide a generic framework with no dependency on a specific bounty task type.

### 4.1 Responsibilities

The engine should manage:

- `bounty_id`
- `status`
- `reward_wei`
- `submission_deadline`
- `submission_id`
- `solver_address`
- `decision`
- `confidence`
- `payout_tx_hash`

### 4.2 Lifecycle

The minimum lifecycle is:

- `OPEN`
- `SUBMITTED`
- `UNDER_REVIEW`
- `APPROVED`
- `REJECTED`
- `PAID`
- `EXPIRED`

### 4.3 Generic Engine Operations

The engine should expose generic operations such as:

- create bounty
- publish bounty
- submit answer or proof
- evaluate submission
- finalize result
- send reward
- expose result

These operations should remain the same no matter what bounty skill is active.

### 4.4 Generic HTTP/API Surface

The engine can provide stable endpoints such as:

- `GET /bounties`
- `GET /bounties/:id`
- `POST /bounties/:id/submit`
- `GET /bounties/:id/result`

Later, more endpoints can be added without changing the layer split.

### 4.5 Discovery Integration

The engine should publish the host through Agent Discovery.

The host can expose capabilities such as:

- `bounty.list`
- `bounty.get`
- `bounty.submit`
- `bounty.result`

The skill layer may refine semantics, but the engine owns the transport and state handling.

### 4.6 Payout Execution

The engine should be solely responsible for reward payment.

This includes:

- checking available balance
- ensuring the bounty has not already been paid
- ensuring the reward amount is within policy
- sending the `TOS` transaction
- recording the resulting transaction hash

Reward execution should never be embedded directly inside a skill.

## 5. Skill Layer

The skill layer defines how a bounty behaves.

This is the part that should change frequently.

### 5.1 Responsibilities

The skill should define:

- task prompt format
- judging rubric
- expected answer shape
- acceptance criteria
- rejection criteria
- host reasoning instructions
- solver reasoning instructions

### 5.2 What a Skill Should Output

The skill should not directly mutate payout state.

Instead, a host-side bounty skill should return a bounded evaluation result.

Example:

```json
{
  "decision": "accepted",
  "confidence": 0.93,
  "reason": "Answer matches the expected canonical answer."
}
```

The Core Bounty Engine consumes this result and decides whether to pay.

### 5.3 Good First Skills

Examples of bounty skills:

- `question-bounty-host`
- `question-bounty-solver`
- `social-proof-bounty-host`
- `social-proof-bounty-solver`
- `translation-bounty-host`
- `translation-bounty-solver`

### 5.4 Why Skills Are the Right Place

Skills are the right layer for:

- task instructions
- judging prompts
- solver strategies
- bounty-specific behavior

Skills are not the right layer for:

- persistent storage
- HTTP servers
- discovery publication
- chain payments
- state transitions

Those belong in the engine.

## 6. Config Layer

The config layer makes the engine and skills deployable in different modes.

### 6.1 Example Configuration Concerns

Configuration should decide:

- is bounty mode enabled
- is this node a host or a solver
- which skill should be loaded
- what reward amount is used
- what confidence threshold allows payout
- what model/backend is used
- what maximum active bounty count is allowed

### 6.2 Example Config Shape

An example config section:

```json
{
  "bounty": {
    "enabled": true,
    "role": "host",
    "skill": "question-bounty-host",
    "rewardWei": "10000000000000000",
    "autoPayConfidenceThreshold": 0.9,
    "maxOpenBounties": 10
  }
}
```

Solver mode could look like:

```json
{
  "bounty": {
    "enabled": true,
    "role": "solver",
    "skill": "question-bounty-solver"
  }
}
```

### 6.3 Config Should Not Duplicate Skill Logic

Config should control policy and deployment behavior.

Config should not replace the skill layer by inlining long task instructions or judging rules.

That material belongs in skills.

## 7. Recommended Internal Split

The cleanest split in OpenFox is:

- `bounty/`
  - generic engine
  - storage
  - lifecycle
  - payout
  - API handlers
- `skills/`
  - bounty-specific host and solver behaviors
- `openfox.json`
  - role and policy configuration

## 8. First MVP Recommendation

For the first bounty MVP:

- build one reusable bounty engine
- implement one host skill
- implement one solver skill
- keep judging bounded and machine-readable
- keep rewards small

Recommended first skills:

- `question-bounty-host`
- `question-bounty-solver`

This proves the pattern without locking the codebase to only one bounty type.

## 9. Question Bounty Is Only the First Skill

The first MVP uses a question-and-answer bounty because it is the simplest way to validate the pattern.

This does **not** mean OpenFox should become a "question answering system" at the core.

The question bounty is only:

- the first host skill
- the first solver skill
- the first bounded evaluation format

What should remain reusable is the engine, not the specific question task.

The reusable part is:

- publish a task
- receive a submission
- evaluate the submission
- record a result
- pay a reward

That same structure can support many different bounty types.

## 10. Which Future Tasks Still Fit the Bounty Engine

Many future tasks can reuse the same bounty engine.

Examples:

- social proof tasks
  - post a phrase
  - reply to a post
  - submit a link
- translation tasks
- summarization tasks
- classification tasks
- lightweight observation tasks
- lightweight prediction tasks
- proof submission tasks

These tasks still fit the same broad pattern:

- a host publishes a task
- a solver submits work
- the host evaluates the work
- the host pays a reward

For these, the engine should remain unchanged.
Only the skill and config should usually change.

## 11. Which Future Tasks Should Not Use the Bounty Engine

Not every future OpenFox task belongs inside the bounty engine.

Examples that should eventually use a different engine:

- persistent personal assistant behavior
- long-running research agents
- customer support agents
- continuous monitoring agents
- workflow automation agents
- open-ended multi-step execution services

These are not "publish one task, submit one answer, pay one reward" systems.

They need different primitives, such as:

- workflow execution
- task scheduling
- long-lived sessions
- service invocation
- recurring stateful coordination

So the bounty engine should stay narrow and clean.
It should not become the universal engine for all agent behavior.

## 12. Practical Expansion Rule

A good rule is:

- if the task is "post one job, receive one submission, judge once, pay once", it probably fits the bounty engine
- if the task is "maintain an ongoing service or workflow", it probably needs a different engine

This keeps OpenFox modular.

## 13. Future Expansion

Once the three-layer split exists, new bounty modes become much cheaper.

Examples:

- social proof bounty
- translation bounty
- observation bounty
- lightweight prediction bounty
- research bounty

The engine should remain mostly unchanged.

Only the skill and config should usually change.

## 14. Key Principle

The key principle is:

`the runtime owns mechanics, the skill owns behavior, the config owns deployment`

This is how OpenFox avoids rewriting the runtime for every new bounty MVP.
