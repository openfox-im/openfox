import { createHash } from "node:crypto";

function detectContentType(request) {
  if (typeof request.content_type === "string" && request.content_type.trim()) {
    return request.content_type.trim();
  }
  if (request.content_text !== undefined) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export async function run(input) {
  const request = input?.request ?? {};
  const options = input?.options ?? {};
  if (request.content_text === undefined && request.content_base64 === undefined) {
    throw new Error("storage.put requires content_text or content_base64");
  }
  const buffer =
    request.content_base64 !== undefined
      ? Buffer.from(String(request.content_base64), "base64")
      : Buffer.from(String(request.content_text || ""), "utf8");
  const maxObjectBytes = Number(options.maxObjectBytes || 262_144);
  if (buffer.byteLength > maxObjectBytes) {
    throw new Error(`object exceeds maxObjectBytes (${maxObjectBytes})`);
  }
  const maxTtlSeconds = Number(options.maxTtlSeconds || 2_592_000);
  if (
    request.ttl_seconds !== undefined &&
    (!Number.isInteger(request.ttl_seconds) ||
      request.ttl_seconds <= 0 ||
      request.ttl_seconds > maxTtlSeconds)
  ) {
    throw new Error(`ttl_seconds must be a positive integer <= ${maxTtlSeconds}`);
  }
  const ttlSeconds = request.ttl_seconds ?? Number(options.defaultTtlSeconds || 86_400);
  const nowMs = Number(input?.nowMs || Date.now());
  const hashHex = createHash("sha256").update(buffer).digest("hex");
  return {
    objectId: hashHex,
    objectKey:
      typeof request.object_key === "string" && request.object_key.trim()
        ? request.object_key.trim()
        : undefined,
    contentType: detectContentType(request),
    contentSha256: `0x${hashHex}`,
    sizeBytes: buffer.byteLength,
    ttlSeconds,
    expiresAt: Math.floor((nowMs + ttlSeconds * 1000) / 1000),
    bufferBase64: buffer.toString("base64"),
    backend: "skill:storage-object.put",
  };
}
