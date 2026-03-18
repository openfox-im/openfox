# Provider Backend Contract

Stage: `newsfetch.capture`
Contract JSON: `capture-contract.json`
Version: `v1`

Input:

- `request.source_url`
- optional `request.publisher_hint`
- optional `request.headline_hint`
- `options.allowPrivateTargets`
- `options.requestTimeoutMs`
- `options.maxResponseBytes`
- `options.maxArticleChars`

Output:

- `canonicalUrl`
- `httpStatus`
- `contentType`
- `articleSha256`
- optional `articleText`
- optional `headline`
- optional `publisher`
