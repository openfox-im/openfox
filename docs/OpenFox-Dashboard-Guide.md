# OpenFox Dashboard Guide

`openfox dashboard` turns fleet-level operator snapshots into reusable dashboard
artifacts.

It is built on top of the existing authenticated operator API and fleet
snapshot surfaces, so it does not introduce a second monitoring protocol.

## Commands

```bash
openfox dashboard show --manifest ./fleet.yml
openfox dashboard show --manifest ./fleet.yml --json
openfox dashboard export --manifest ./fleet.yml --format json --output ./dashboard.json
openfox dashboard export --manifest ./fleet.yml --format html --output ./dashboard.html
openfox dashboard bundle --manifest ./fleet.yml --output ./dashboard-bundle
```

## What It Includes

The fleet dashboard currently aggregates:

- runtime status
- health snapshots
- managed service status
- gateway status
- storage status
- storage lease-health
- artifact status
- signer-provider status
- paymaster-provider status
- provider reputation summaries

Each export keeps:

- manifest path
- generation timestamp
- role counts
- endpoint health summary
- per-node payload summaries

## Recommended Usage

Use `show` when you want a quick operator snapshot in the terminal.

Use `export --format json` when:

- another script needs a machine-readable snapshot
- you want to store periodic fleet reports
- you want to feed the data into another dashboard layer

Use `export --format html` when:

- you want a shareable static operator report
- you want a lightweight public or internal status page
- you need a human-readable artifact for audits or operations reviews

Use `bundle` when:

- you want one directory that contains the manifest copy, dashboard JSON, dashboard HTML, and lint report
- you need a shareable audit bundle for another operator or control plane
- you want a repeatable export target for CI or scheduled fleet snapshots

## Scope

This dashboard surface is intentionally read-only.

It does not replace:

- `openfox fleet repair ...`
- `openfox storage maintain`
- `openfox artifacts maintain`
- `openfox doctor`

Instead, it gives operators a stable way to export the current state before
triggering repairs or maintenance.
