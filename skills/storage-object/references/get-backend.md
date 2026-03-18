# Provider Backend Contract

Stage: `storage-object.get`
Contract JSON: `get-contract.json`
Version: `v1`

Input:

- request fields used for rendering and bounds
- stored object metadata
- `bufferBase64`
- `nowMs`

Output on success:

- `status = ok`
- `response`

Output on rejection:

- `status = rejected`
- `httpStatus`
- `reason`
- optional `pruneExpired`
