# OpenFox Template Guide

OpenFox ships with bundled templates so third-party operators do not need to
invent their first deployment from scratch.

## List templates

```bash
pnpm openfox templates list
```

## Show a template README

```bash
pnpm openfox templates show local-marketplace
```

## Export a template

```bash
pnpm openfox templates export local-marketplace --output ./examples/local-marketplace
```

If the destination already exists:

```bash
pnpm openfox templates export local-marketplace --output ./examples/local-marketplace --force
```

## Bundled templates

- `third-party-quickstart`
- `local-marketplace`
- `public-provider`
- `public-fleet-operator`
- `task-sponsor`

## Recommended usage

- start with `third-party-quickstart` if you are new
- use `local-marketplace` for one-machine host/solver/scout testing
- use `public-provider` for provider + gateway deployment
- use `public-fleet-operator` for multi-node operator APIs and dashboard exports
- use `task-sponsor` when the main job is publishing tasks and rewards
