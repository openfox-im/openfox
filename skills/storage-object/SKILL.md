---
name: storage-object
description: Deterministic object preparation and rendering backend for immutable storage providers.
provider-backends:
  put:
    entry: scripts/put.mjs
    description: Validate and normalize immutable object writes.
  get:
    entry: scripts/get.mjs
    description: Render immutable object reads with expiry and size checks.
---
Use this skill for bounded immutable object write/read preparation.
Load the stage summaries:

- `references/put-backend.md`
- `references/get-backend.md`

Load the machine-readable contracts:

- `references/put-contract.json`
- `references/get-contract.json`
