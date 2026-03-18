import {
  extractArticleText,
  extractHeadline,
  fetchBoundedUrl,
  validateHttpTargetUrl,
} from "../../_shared/http-utils.mjs";

export async function run(input) {
  const request = input?.request ?? {};
  const options = input?.options ?? {};
  const sourceUrl = validateHttpTargetUrl(String(request.source_url || ""), {
    allowPrivateTargets: options.allowPrivateTargets === true,
  });
  const fetched = await fetchBoundedUrl(sourceUrl, {
    timeoutMs: Number(options.requestTimeoutMs || 10_000),
    maxResponseBytes: Number(options.maxResponseBytes || 262_144),
  });
  const articleText = extractArticleText(
    fetched.contentType,
    fetched.body,
    Number(options.maxArticleChars || 12_000),
  );
  const headline =
    typeof request.headline_hint === "string" && request.headline_hint.trim()
      ? request.headline_hint.trim()
      : extractHeadline(fetched.contentType, fetched.body);
  const publisher =
    typeof request.publisher_hint === "string" && request.publisher_hint.trim()
      ? request.publisher_hint.trim()
      : sourceUrl.hostname;

  return {
    canonicalUrl: fetched.canonicalUrl,
    httpStatus: fetched.status,
    contentType: fetched.contentType,
    articleSha256: fetched.bodySha256,
    articleText,
    headline,
    publisher,
    backend: "skill:newsfetch.capture",
  };
}
