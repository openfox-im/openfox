# OpenFox Local metaWorld Demo Guide

This guide covers the packaged local multi-node OpenFox `metaWorld` demo bundle.

The goal is to let operators generate, inspect, serve, and validate a replicated
Fox world without assembling the topology by hand.

## 1. Export the demo bundle

```bash
pnpm openfox world demo export --output-dir ./tmp/openfox-metaworld-demo --force
```

This writes a seeded bundle containing:

- three local node homes: `alpha`, `beta`, and `observer`
- separate `.openfox` state for each node
- seeded SQLite state with one replicated Group and shared activity
- pre-exported static site bundles for every node
- `metaworld-demo.json` describing the topology
- helper scripts under `scripts/`

## 2. Inspect the bundle

The exported bundle includes:

- `README.md`
- `metaworld-demo.json`
- `nodes/<node>/.openfox/openfox.json`
- `nodes/<node>/.openfox/wallet.json`
- `nodes/<node>/.openfox/metaworld.db`
- `sites/<node>/...`
- `scripts/serve-node.sh`
- `scripts/validate.sh`

## 3. Serve a node locally

Run one node in a terminal:

```bash
./tmp/openfox-metaworld-demo/scripts/serve-node.sh alpha
```

Run a second node in another terminal:

```bash
./tmp/openfox-metaworld-demo/scripts/serve-node.sh beta
```

By default the helper script uses `pnpm openfox`.

If your OpenFox CLI is available another way, override it:

```bash
OPENFOX_BIN="npx @openfox/openfox" ./tmp/openfox-metaworld-demo/scripts/serve-node.sh observer
```

## 4. Validate the demo bundle

Run the built-in end-to-end validator:

```bash
./tmp/openfox-metaworld-demo/scripts/validate.sh
```

Or call the command directly:

```bash
pnpm openfox world demo validate --bundle ./tmp/openfox-metaworld-demo --json
```

The validator:

- loads every node database from the bundle
- starts temporary `metaWorld` HTTP servers for all nodes
- checks that the replicated Group is visible on every node
- checks that Group page counts match the seeded expectations
- checks that feeds contain the replicated activity titles
- checks that live HTML pages and regenerated static site exports both contain
  the same synchronized Group content

## 5. What "success" means

The bundle is valid when:

- all validation checks return `ok`
- the replicated Group appears in every node's directory and page routes
- the same announcement and message titles appear in feed and page output across
  the nodes
- regenerated site exports still contain the synchronized Group page

## 6. Intended use

Use this bundle to:

- smoke-test a local Fox world after large `metaWorld` changes
- demo synchronized Group pages and feeds to collaborators
- validate that static export and live web routes agree on the same replicated
  state
- give operators one reproducible local `metaWorld` environment instead of
  assembling multiple OpenFox homes manually
