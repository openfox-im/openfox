---
name: newsfetch
description: Deterministic bounded public news fetching backend for provider capabilities.
provider-backends:
  capture:
    entry: scripts/capture.mjs
    description: Fetch one bounded public URL and extract stable article fields.
---
Use this skill for bounded public-news capture backends.
Load `references/provider-backend.md` for the stage summary.
Load `references/capture-contract.json` for the machine-readable I/O contract.
