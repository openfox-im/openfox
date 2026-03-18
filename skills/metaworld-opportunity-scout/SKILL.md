---
name: metaworld-opportunity-scout
description: Observe opportunity items from scout results and world feed, evaluate their quality and profitability, and decide whether to publish MetaWorld intents.
auto-activate: true
---

# MetaWorld Opportunity Scout

Use this skill when you discover earning opportunities and need to decide whether to convert them into MetaWorld intents.

## When to activate

- After running the opportunity scout and receiving ranked results
- When the world feed surfaces new opportunities
- During periodic heartbeat scans for new economic activity

## Decision framework

1. **Evaluate opportunity quality**: Consider the margin (grossValue - estimatedCost), trust tier, deadline pressure, and strategy fit.
2. **Set a reasonable budget**: The intent budget should be a fraction of the expected margin — never commit more than 80% of projected gross value. Factor in execution risk.
3. **Choose the right intent kind**: Map the opportunity type to the appropriate intent kind (work, opportunity, procurement, collaboration).
4. **Define clear requirements**: Specify the capabilities needed so solvers can self-select. Be specific but not overly restrictive.
5. **Consider timing**: If the opportunity has a tight deadline, set a shorter intent expiry. If it requires coordination, allow more time.

## Anti-patterns

- Do NOT create intents for opportunities with negative margins
- Do NOT set budgets higher than the opportunity's gross value
- Do NOT create duplicate intents for the same opportunity
- Do NOT ignore trust tier — prefer self_hosted and org_trusted over unknown

## Tool

Use `metaworld_scout_opportunities` to scan for opportunities, evaluate them, and optionally create intents.
