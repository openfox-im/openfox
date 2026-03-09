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
  - Status: In progress
  - Goal: Turn the bounty architecture into a working question-bounty loop with
    local judging, native payout, HTTP host endpoints, and basic solver flows.

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
