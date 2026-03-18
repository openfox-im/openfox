# OpenFox Public Fleet Control-Plane Guide

This guide describes the control-plane workflow for public multi-node OpenFox
deployments.

The goal is to make one exported fleet bundle usable as a repeatable operator
artifact instead of leaving public-fleet operations as ad-hoc shell knowledge.

## 1. Export the starting bundle

Start from the bundled template:

```bash
openfox templates export public-fleet-operator --output ./public-fleet
```

This exports:

- `fleet.yml`
- `README.md`
- `operator-notes.md`
- dashboard helper scripts

## 2. Replace placeholders and lint the manifest

Before running any fleet-wide status or control command:

```bash
cd ./public-fleet
openfox fleet lint --manifest ./fleet.yml
openfox fleet lint --manifest ./fleet.yml --json
```

The fleet linter now checks:

- duplicate names
- duplicate base URLs
- placeholder URLs and auth tokens
- non-HTTPS public endpoints
- missing roles
- invalid public-fleet roles
- missing `gateway`, `host`, or provider-role coverage

## 3. Export the reusable dashboard bundle

```bash
openfox dashboard bundle --manifest ./fleet.yml --output ./bundle --force --json
```

The bundle includes:

- a manifest copy
- `dashboard.json`
- `dashboard.html`
- `fleet-lint.json`
- `control-events.json`
- `autopilot.json`
- `approvals.json`

## 4. Consume the exported bundle

Use the bundle consumer to validate what was exported:

```bash
openfox fleet bundle inspect --bundle ./bundle
openfox fleet bundle inspect --bundle ./bundle --json
```

The bundle inspection surface is intended for:

- operator review
- control-plane automation
- CI checks on exported fleet bundles
- downstream dashboard consumers

The JSON snapshot includes:

- manifest presence and role counts
- dashboard presence and failing endpoints
- lint error and warning counts
- presence of control, autopilot, and approval exports

## 5. Recommended operator loop

For a public deployment, the control-plane loop should look like this:

1. export or update the public-fleet template
2. replace placeholders in `fleet.yml`
3. run `openfox fleet lint --manifest ./fleet.yml`
4. run `openfox fleet status --manifest ./fleet.yml --json`
5. run `openfox dashboard bundle --manifest ./fleet.yml --output ./bundle --force`
6. run `openfox fleet bundle inspect --bundle ./bundle --json`
7. archive or publish the resulting bundle

## 6. Why this matters

OpenFox already had:

- fleet status
- fleet doctor
- fleet repair
- dashboard export

The missing piece was a reusable control-plane bundle workflow.

This guide closes that gap:

- one manifest
- one lint flow
- one dashboard bundle
- one bundle consumer surface

That makes public multi-node OpenFox deployments easier to audit, easier to
package, and easier to integrate into external operator tooling.
