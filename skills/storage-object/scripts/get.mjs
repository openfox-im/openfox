export async function run(input) {
  const request = input?.request ?? {};
  const object = input?.object ?? {};
  const nowMs = Number(input?.nowMs || Date.now());
  const expiresAtMs = Date.parse(String(object.expiresAt || ""));
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
    return {
      status: "rejected",
      httpStatus: 410,
      reason: "object expired",
      pruneExpired: true,
      backend: "skill:storage-object.get",
    };
  }
  if (
    request.max_bytes !== undefined &&
    Number(object.sizeBytes || 0) > Number(request.max_bytes)
  ) {
    return {
      status: "rejected",
      httpStatus: 400,
      reason: `object exceeds requested max_bytes (${request.max_bytes})`,
      backend: "skill:storage-object.get",
    };
  }

  const buffer =
    typeof input?.bufferBase64 === "string"
      ? Buffer.from(input.bufferBase64, "base64")
      : Buffer.alloc(0);
  const response = {
    status: "ok",
    object_id: object.objectId,
    expires_at: Math.floor(expiresAtMs / 1000),
    content_type: object.contentType,
    content_sha256: object.contentSha256,
    size_bytes: object.sizeBytes,
    metadata: object.metadata,
    ...(request.inline_base64 === false
      ? {}
      : { content_base64: buffer.toString("base64") }),
    ...(String(object.contentType || "").startsWith("text/") ||
    String(object.contentType || "").includes("json")
      ? { content_text: buffer.toString("utf8") }
      : {}),
  };

  return {
    status: "ok",
    response,
    backend: "skill:storage-object.get",
  };
}
