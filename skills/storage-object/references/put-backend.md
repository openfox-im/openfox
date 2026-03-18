# Provider Backend Contract

Stage: `storage-object.put`
Contract JSON: `put-contract.json`
Version: `v1`

Input:

- `request.content_text` or `request.content_base64`
- optional `request.object_key`
- optional `request.content_type`
- optional `request.ttl_seconds`
- `options.maxObjectBytes`
- `options.defaultTtlSeconds`
- `options.maxTtlSeconds`
- `nowMs`

Output:

- `objectId`
- optional `objectKey`
- `contentType`
- `contentSha256`
- `sizeBytes`
- `ttlSeconds`
- `expiresAt`
- `bufferBase64`
