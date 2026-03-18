# Provider Backend Contract

Stage: `zktls.bundle`
Contract JSON: `bundle-contract.json`
Version: `v1`

Input:

- original `request`
- `fetchedAt`
- `capture.canonicalUrl`
- `capture.httpStatus`
- `capture.contentType`
- `capture.articleSha256`
- optional `capture.articleText`
- optional `capture.headline`
- optional `capture.publisher`

Output:

- `format`
- `bundleSha256`
- `bundle`
