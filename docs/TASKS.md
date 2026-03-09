# OpenFox Task Overview

This file tracks the runtime refactor priorities that should not get lost while
building OpenFox into a TOS-native agent platform.

## Current Priorities

- [x] Task 1: Rebuild the skills system around a repo-native skill catalog
  - Status: Complete
  - Goal: Move OpenFox away from inline default skills and direct skill
    instruction injection toward a bundled/managed/workspace skill snapshot model
    inspired by OpenClaw.
- [x] Task 2: Productize heartbeat, cron, and operator UX
  - Status: Complete
  - Goal: Keep the always-on OpenFox runtime, but expose scheduling, status,
    wakeups, and operator controls in a cleaner product surface.
- [x] Task 3: Finish gateway and service operator UX
  - Status: Complete
  - Goal: Keep the existing discovery/gateway protocol line, then improve
    deployment, health checks, service management, and operational examples.
- [x] Task 4: Add managed service install and lifecycle UX
  - Status: Complete
  - Goal: Make OpenFox easier to run as an always-on user service with
    install/start/stop/restart/uninstall flows closer to OpenClaw.
- [x] Task 5: Add doctor and health diagnostics UX
  - Status: Complete
  - Goal: Give operators a one-command way to inspect config, wallet,
    inference, RPC, service state, and next-step repair guidance.
- [x] Task 6: Add model/provider status UX
  - Status: Complete
  - Goal: Make provider readiness visible with an operator command similar to
    OpenClaw's model status surface, without expanding the provider matrix.
- [x] Task 7: Add onboarding command UX
  - Status: Complete
  - Goal: Provide an OpenClaw-style onboarding entrypoint that can initialize
    OpenFox and optionally install the managed service in one flow.
- [x] Task 8: Add logs operator UX
  - Status: Complete
  - Goal: Give operators a direct way to inspect recent OpenFox runtime logs
    without leaving the CLI.
- [x] Task 9: Add machine-readable runtime status surfaces
  - Status: Complete
  - Goal: Expose heartbeat, cron, service, gateway, and top-level runtime
    status as stable JSON snapshots for automation, dashboards, and future
    control plane integrations.
- [x] Task 10: Build the first bounty host/solver runtime slice
  - Status: Complete
  - Goal: Turn the bounty architecture into a working bounded-task loop with
    local judging, native payout, HTTP host endpoints, and automated solver
    flows.
- [x] Task 11: Generalize bounty into a task marketplace slice
  - Status: Complete
  - Goal: Move beyond a single question-only bounty and support multiple task
    kinds through one reusable engine, HTTP API, CLI surface, and skill-driven
    host/solver flow.
- [x] Task 12: Add non-question task skills
  - Status: Complete
  - Goal: Add bundled task skills beyond the original question flow so OpenFox
    can host and solve translation, social proof, and third-party
    problem-solving work without changing the core engine.
- [x] Task 13: Add third-party problem solving, social bounty, and translation flows
  - Status: Complete
  - Goal: Make "ask another agent to solve something useful" a first-class path
    instead of a one-off question demo.
- [x] Task 14: Add TOS opportunity scout and earning surfaces
  - Status: Complete
  - Goal: Give OpenFox a direct way to discover and rank bounty, provider, and
    sponsored capability opportunities on the network.
- [x] Task 15: Improve deployment and local multi-node integration
  - Status: Complete
  - Goal: Add an explicit local multi-role operator path for host, solver, and
    scout roles instead of relying on ad-hoc shell setup.
- [x] Task 16: Add MVP anti-abuse and policy closure
  - Status: Complete
  - Goal: Add the first production-style guardrails around payouts and solver
    submissions so the marketplace slice is not wide open by default.
- [x] Task 17: Launch the first real paid observation service
  - Status: Complete
  - Goal: Turn the existing `observation.once` provider into a real paid
    service with stable request/result semantics, payment idempotency, and job
    retrieval instead of a one-off test payload flow.
- [ ] Task 18: Launch the first paid oracle resolution service
  - Status: Pending
  - Goal: Add a narrow paid oracle-style service on top of the same TOS-native
    runtime base without importing a full decentralized oracle protocol.

## Task 1 Breakdown

- [x] Create a repository-native `skills/` directory with bundled skills.
- [x] Stop generating bundled skills from inline strings during setup.
- [x] Load skills from multiple sources with precedence:
  - `bundled < managed < workspace`
- [x] Build a compact skill snapshot for the model prompt.
- [x] Add a richer skills CLI and operator surface:
  - `openfox skills list`
  - `openfox skills status`
  - `openfox skills install`
  - `openfox skills enable/disable`
- [x] Add eligibility checks, richer metadata, and installation hints closer to
  the OpenClaw model.

## Task 2 Breakdown

- [x] Define a stable heartbeat status and scheduler UX.
- [x] Add a cron/task operator surface.
- [x] Expose runtime state, wake reasons, and scheduler history clearly.
- [x] Document the operator flow for always-on OpenFox agents.

## Task 3 Breakdown

- [x] Add service deployment examples for requester, provider, and gateway roles.
- [x] Add health checks and operational troubleshooting for gateway/service mode.
- [x] Add service management examples for local, LAN, and public deployments.
- [x] Make the gateway operator path easier to configure and inspect.

## Task 4 Breakdown

- [x] Add Linux user-systemd install and uninstall flows.
- [x] Add start/stop/restart lifecycle commands.
- [x] Surface managed service state in the operator CLI.
- [x] Document managed service installation and runtime expectations.

## Task 5 Breakdown

- [x] Add `openfox health` for a compact runtime health snapshot.
- [x] Add `openfox doctor` for actionable diagnostic findings and repair hints.
- [x] Cover config, wallet, inference, RPC, skills, heartbeat, and service state.
- [x] Support machine-readable `--json` output for future UI/control plane use.

## Task 6 Breakdown

- [x] Add `openfox models status`.
- [x] Show selected model/provider and provider readiness.
- [x] Support `--check` for local Ollama probing.
- [x] Support `--json` output for automation and future UI use.

## Task 7 Breakdown

- [x] Add `openfox onboard`.
- [x] Support `openfox onboard --install-daemon`.
- [x] Reuse the existing setup wizard instead of inventing a second init flow.
- [x] Keep onboarding compatible with the managed service lifecycle.

## Task 8 Breakdown

- [x] Add `openfox logs`.
- [x] Support `--tail` line count selection.
- [x] Point the operator to the managed service log path.

## Task 9 Breakdown

- [x] Add `--json` output to `openfox heartbeat status|tasks|history`.
- [x] Add `--json` output to `openfox cron list|status|runs`.
- [x] Add `--json` output to `openfox service status|check`.
- [x] Add `--json` output to `openfox gateway status|bootnodes|check`.
- [x] Add `openfox status --json` as a top-level machine-readable status
  surface.
- [x] Back the JSON output with explicit snapshot builders instead of ad-hoc
  report parsing.

## Task 10 Breakdown

- [x] Add bounty config and local database tables.
- [x] Add a core bounty engine with question-bounty lifecycle handling.
- [x] Add host-side HTTP endpoints for bounty create/list/get/submit/result.
- [x] Add host-side automatic judging and native payout hooks.
- [x] Add a minimal solver-side client and CLI surface.
- [x] Publish bounty host capability through Agent Discovery in a more explicit
  operator-facing way.
- [x] Add bundled bounty skills and defaults for host/solver mode.
- [x] Add README/operator documentation for running a host and solver pair.
- [x] Add host-side auto-open for one bounded question bounty.
- [x] Add solver-side automatic discovery/direct polling and auto-submit.
- [x] Generalize the bounty schema and engine from question-only to multi-kind.
- [x] Keep backward-compatible `question` aliases in the CLI while shifting the
  runtime to generic task fields.
- [x] Add auto-open and auto-solve compatibility with kind-specific skills.

## Task 11 Breakdown

- [x] Add generic task fields to bounty storage and runtime models.
- [x] Add schema migration for multi-kind bounty records and submissions.
- [x] Add a generic task open/submit/solve HTTP and CLI surface.
- [x] Keep the original question bounty path working as a compatibility layer.

## Task 12 Breakdown

- [x] Add bundled skills for translation host/solver.
- [x] Add bundled skills for social proof host/solver.
- [x] Add bundled skills for third-party problem-solving host/solver.
- [x] Add a bundled opportunity scout skill for ranking earning surfaces.

## Task 13 Breakdown

- [x] Support `translation` task bounties.
- [x] Support `social_proof` task bounties.
- [x] Support `problem_solving` task bounties.
- [x] Route solver prompts and judge prompts by task kind.

## Task 14 Breakdown

- [x] Add `opportunityScout` config.
- [x] Add an opportunity collector for remote tasks and discovery providers.
- [x] Add `openfox scout list`.
- [x] Add an operator-readable scout report.

## Task 15 Breakdown

- [x] Add a local multi-role wrapper script for host, solver, and scout roles.
- [x] Add a local task marketplace operator guide.
- [x] Keep the role wrapper isolated by `$HOME` so roles do not trample each
  other.

## Task 16 Breakdown

- [x] Add bounty policy configuration.
- [x] Enforce trusted proof URL checks for social proof tasks.
- [x] Enforce solver cooldown windows.
- [x] Enforce max auto-pay per solver per 24h.

## Task 17 Breakdown

- [x] Reuse the existing observation provider instead of inventing a second
  paid-service stack.
- [x] Add `POST /observe` as a stable paid observation request surface.
- [x] Add `GET /jobs/:id` for persisted observation result retrieval.
- [x] Bind duplicate requests to one stored job/result instead of charging
  again.
- [x] Persist a payment-bound observation result receipt with `job_id`,
  `result_url`, and `payment_tx_hash`.
- [x] Update runtime docs and roadmap state to reflect the first real paid
  service slice.

## Task 18 Breakdown

- [ ] Add a narrow `POST /oracle/resolve` surface.
- [ ] Add a minimal `GET /oracle/result/:id` lookup surface.
- [ ] Reuse the existing task marketplace and local-model judging path where
  possible.
- [ ] Bind paid requests to stored oracle result receipts.
- [ ] Keep the first oracle service bounded and TOS-native.
