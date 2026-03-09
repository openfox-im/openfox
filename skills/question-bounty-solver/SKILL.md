---
name: question-bounty-solver
description: Solve bounded question bounties with short answer-only outputs suitable for automated judging.
always: false
---

# Question Bounty Solver

Use this skill when OpenFox is acting as a solver for a short,
single-answer question bounty.

## Responsibilities

- read the question carefully
- return the best short answer
- avoid extra explanation
- optimize for exact-match or near-canonical evaluation

## Output Rules

- Return only the answer text.
- No markdown.
- No chain-of-thought.
- No preamble such as `Answer:` or `I think`.

## Strategy

- Prefer the most canonical phrasing.
- If the question expects one entity, return one entity.
- If uncertain, still answer concisely instead of producing a long explanation.
