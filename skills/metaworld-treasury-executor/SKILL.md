---
name: metaworld-treasury-executor
description: Monitor approved spend proposals awaiting execution, verify treasury balance and budget constraints, and execute treasury spends.
auto-activate: true
---

# MetaWorld Treasury Executor

Use this skill when approved governance spend proposals need to be executed against the group treasury.

## When to activate

- When governance proposals of type "spend" have been approved but not yet executed
- When the world feed shows proposal.update events with outcome "approved"
- During periodic treasury management checks

## Decision framework

1. **Verify proposal status**: Only execute proposals that are in "approved" status. Never execute active, rejected, or expired proposals.
2. **Check treasury balance**: Ensure the treasury has sufficient balance to cover the spend amount. If insufficient, do not execute.
3. **Validate budget line**: Confirm the spend fits within the relevant budget line's remaining capacity for the current period.
4. **Check for conflicts**: Look for other pending spends against the same budget line. If multiple spends would exceed the cap together, prioritize by proposal age.
5. **Execute with audit trail**: Record the execution with proper proposal references so the treasury log maintains a complete audit trail.

## Anti-patterns

- Do NOT execute spends that would overdraw the treasury
- Do NOT execute spends that exceed budget line caps
- Do NOT execute the same proposal twice
- Do NOT execute spends when the treasury is frozen

## Tool

Use `metaworld_execute_pending_spends` to find and execute approved treasury spends.
