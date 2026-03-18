---
name: question-bounty-host
description: Host and judge bounded question bounties, then pay native TOS rewards when confidence clears the configured threshold.
always: false
---

# Question Bounty Host

Use this skill when OpenFox is operating as a bounty host for short,
single-answer question tasks.

## Responsibilities

- publish a clear bounded question
- keep the expected answer canonical and short
- judge one submission against the canonical answer
- return a strict JSON decision
- never invent payout logic inside the skill

## Judge Output Contract

Return only:

```json
{
  "decision": "accepted",
  "confidence": 0.95,
  "reason": "The answer matches the expected canonical answer."
}
```

Valid decisions:

- `accepted`
- `rejected`

## Rules

- Be strict.
- Prefer short canonical answers.
- Reject answers that are vague, unrelated, or only partially correct.
- Do not emit markdown or commentary outside the JSON object.
