# OpenFox Parallel Work Map

This document defines non-overlapping parallel workstreams for the next stage
of OpenFox development. The goal is to let multiple coding agents work in
parallel without repeatedly colliding in the same core files.

## Shared Rules

- Keep OpenFox TOS-native.
- Do not reintroduce Base, ERC-8004, USDC x402, or 20-byte primary wallet
  semantics.
- Prefer extending current surfaces instead of inventing parallel protocol
  stacks.
- Avoid editing the same core state files from multiple workstreams at once.

## Workstream A: Owner Action Product Loop

Goal:

- continue the owner opportunity flow beyond queued pursue execution and add
  bounded delegate/provider-call execution plus follow-up journaling

Primary areas:

- `src/reports/`
- `src/operator/`
- `src/doctor/`
- `src/index.ts`
- `src/__tests__/owner-*`

Allowed shared files:

- `src/types.ts`
- `src/state/schema.ts`
- `src/state/database.ts`

Constraint:

- this workstream should be the only one touching owner-action state and owner
  report persistence at a time

## Workstream B: Fleet and Control Plane

Goal:

- strengthen public multi-node deployment, bundle export, dashboard consumers,
  and operator control-plane packaging

Primary areas:

- `src/service/`
- `src/operator/`
- `src/fleet*`
- `docs/*Fleet*`
- `docs/*Dashboard*`
- `docs/*Deployment*`

Avoid touching:

- `src/reports/action-*`
- `src/state/schema.ts`
- `src/state/database.ts`

## Workstream C: Ecosystem SDK and Examples

Goal:

- make `tosdk` and the OpenFox provider surfaces easier for third-party
  builders to consume

Primary areas:

- `../tosdk/examples/`
- `../tosdk/src/clients/`
- `../tosdk/src/transports/`
- `../tosdk/README.md`
- `docs/*SDK*`

Avoid touching:

- OpenFox runtime state
- GTOS protocol changes unless absolutely required

## Workstream D: New Work Surfaces

Goal:

- grow new work/product loops on top of the existing platform without changing
  the underlying runtime model

Primary areas:

- `src/bounty/`
- `src/opportunity/`
- `skills/`
- `docs/*Opportunity*`
- `docs/*Bounty*`

Avoid touching:

- `src/state/schema.ts`
- `src/state/database.ts`
- `../tosdk`

## Recommended Order

1. Finish Workstream A first if owner-action execution is still evolving.
2. Run Workstream B and Workstream C in parallel.
3. Run Workstream D after the shared execution/state surfaces have stabilized.

## Anti-Overlap Boundary

The following files should not be edited by more than one active workstream at
the same time:

- `src/types.ts`
- `src/state/schema.ts`
- `src/state/database.ts`
- `src/index.ts`

If a task needs one of these files, assign ownership for that milestone to a
single workstream and keep the others off those paths until the changes land.
