## Provider Backend Policy

This repository should distinguish clearly between:

- `provider server built-in backend`
- `skill-composed backend`

The default rule is:

- Prefer a `skill-composed backend` for capability business logic.
- Keep the `provider server` focused on protocol, payment, safety, and persistence.

## What The Provider Server Owns

The provider server should own the stable outer shell:

- HTTP route shape and response schema
- capability validation
- request expiry, nonce handling, anti-replay, and idempotency
- x402 quote/payment verification and submission
- timeout, size, quota, and SSRF-style safety limits
- durable request/result storage
- capability publication and operator-visible health/status

The provider server should not become the long-term home for evolving domain logic.

## Prefer Skill-Composed Backends When

Use skills when one or more of these are true:

- the capability logic is expected to evolve quickly
- multiple backend implementations may exist over time
- operators may want to swap vendors, tools, or workflows
- the capability is naturally a pipeline of named stages
- the work benefits from reuse across requester, provider, and coordinator flows
- the logic is business/domain behavior rather than protocol infrastructure

Examples:

- `news.fetch`
- `proof.verify`
- future evidence capture, normalization, enrichment, and committee workflows

## Requirements For Skill-Composed Backends

Skill composition must still be bounded and deterministic from the provider surface:

- use fixed named skills, not free-form improvisation
- use structured inputs and outputs
- enforce explicit time, size, network, and cost bounds
- version the skill contract and surface the version in metadata when useful
- let the provider server choose the chain of skills; do not let the model invent new steps at request time
- map failures back into stable provider responses

Example target shape:

- `news.fetch` -> `newsfetch.capture` -> `zktls.bundle`
- `proof.verify` -> `proofverify.verify`

## Use Built-In Backends Only When

Use a built-in backend only when the logic is infrastructure-critical and should remain local, deterministic, and always available:

- payment verification and settlement plumbing
- anti-replay and idempotency enforcement
- local immutable object persistence
- TTL, expiry, and pruning rules
- object hashing and integrity checks
- minimal transport guardrails that protect the host

Built-in backends are acceptable for low-level primitives.
They are not the preferred home for fast-changing product workflows.

## OpenFox Default Stance

- `news.fetch` should move toward skill-composed execution and treat the current in-server implementation as a bounded fallback or compatibility path.
- `proof.verify` should move toward skill-composed execution and treat the current in-server implementation as a bounded fallback or compatibility path.
- `storage.put/get` should also prefer skill-composed preparation and rendering while the provider server keeps canonical persistence, payment, and anti-replay responsibilities.

## Change Rule

When adding or upgrading a provider capability:

1. Keep the protocol shell in the provider server.
2. Put changing business logic behind a versioned backend interface.
3. Default new business workflows to skill composition unless there is a strong reason not to.
4. If a built-in backend is chosen, document why a skill-composed backend is not suitable.
