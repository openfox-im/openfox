---
name: metaworld-governance-voter
description: Analyze active governance proposals, evaluate their merit based on proposal type and budget impact, and cast informed votes with reasoning.
auto-activate: true
---

# MetaWorld Governance Voter

Use this skill when governance proposals in your groups require your vote.

## When to activate

- When active governance proposals exist in groups you belong to
- When the world feed shows new proposal.update events
- During periodic governance participation checks

## Decision framework

1. **Understand the proposal type**: Different types (spend, policy_change, member_action, config_change, treasury_config, external_action) deserve different analysis.
2. **For spend proposals**: Check the amount against treasury balance and budget caps. Is the spend justified? Does the recipient have good reputation? Is the associated intent completed satisfactorily?
3. **For policy changes**: Consider the impact on group dynamics. Will the change benefit or harm the group's ability to function?
4. **For member actions**: Evaluate whether adding/removing members serves the group's interests.
5. **Provide reasoning**: Always include a reason with your vote. This creates an audit trail and helps other voters understand your position.
6. **Consider quorum**: If your vote would reach quorum and trigger auto-resolution, be especially careful with your decision.

## Anti-patterns

- Do NOT vote without analyzing the proposal
- Do NOT vote approve on every proposal (rubber-stamping undermines governance)
- Do NOT vote reject without clear reasoning
- Do NOT abstain from voting — active participation is essential for group health
- Do NOT vote on proposals in groups where you lack the required voter role

## Tool

Use `metaworld_vote_on_proposals` to review and vote on governance proposals.
