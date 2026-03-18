import { createHash } from "node:crypto";
import net from "node:net";
import { URL } from "node:url";

export function isPrivateHost(hostname) {
  const normalized = hostname.trim().toLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  const ipType = net.isIP(normalized);
  if (ipType === 4) {
    if (
      normalized.startsWith("10.") ||
      normalized.startsWith("127.") ||
      normalized.startsWith("192.168.")
    ) {
      return true;
    }
    const second = Number(normalized.split(".")[1] || "0");
    if (normalized.startsWith("172.") && second >= 16 && second <= 31) {
      return true;
    }
  }
  if (
    ipType === 6 &&
    (normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:"))
  ) {
    return true;
  }
  return false;
}

export function validateHttpTargetUrl(value, options = {}) {
  const targetUrl = new URL(value);
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    throw new Error("target URL must use http or https");
  }
  if (!options.allowPrivateTargets && isPrivateHost(targetUrl.hostname)) {
    throw new Error("private target URLs are not allowed");
  }
  return targetUrl;
}

export async function fetchBoundedUrl(targetUrl, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        Accept:
          options.accept ||
          "application/json, text/html;q=0.9, text/plain;q=0.8, */*;q=0.1",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const limited =
      buffer.length > options.maxResponseBytes
        ? buffer.subarray(0, options.maxResponseBytes)
        : buffer;
    return {
      url: targetUrl.toString(),
      canonicalUrl: response.url || targetUrl.toString(),
      status: response.status,
      contentType: response.headers.get("content-type") || "application/octet-stream",
      body: limited,
      bodySha256: `0x${createHash("sha256").update(limited).digest("hex")}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

export function stripHtml(value) {
  return normalizeWhitespace(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">"),
  );
}

export function extractHeadline(contentType, body) {
  const text = body.toString("utf8");
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(text);
      for (const key of ["headline", "title", "name"]) {
        const value = parsed?.[key];
        if (typeof value === "string" && value.trim()) {
          return normalizeWhitespace(value);
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (contentType.includes("html")) {
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (title) return normalizeWhitespace(stripHtml(title));
  }
  const firstLine = normalizeWhitespace(text.split(/\r?\n/)[0] || "");
  return firstLine || undefined;
}

export function extractArticleText(contentType, body, maxArticleChars) {
  const raw = body.toString("utf8");
  let value = raw;
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw);
      for (const key of ["article", "content", "body", "text", "summary"]) {
        const candidate = parsed?.[key];
        if (typeof candidate === "string" && candidate.trim()) {
          value = candidate;
          break;
        }
      }
    } catch {
      value = raw;
    }
  } else if (contentType.includes("html")) {
    value = stripHtml(raw);
  }
  const normalized = normalizeWhitespace(value);
  if (!normalized) return undefined;
  return normalized.slice(0, maxArticleChars);
}

export function extractReferencedSubjectHash(value) {
  if (!value || typeof value !== "object") return undefined;
  for (const key of ["article_sha256", "subject_sha256", "content_sha256", "body_sha256"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && /^0x[0-9a-f]{64}$/i.test(candidate)) {
      return candidate.toLowerCase();
    }
  }
  const metadata = value.metadata;
  if (metadata && typeof metadata === "object") {
    return extractReferencedSubjectHash(metadata);
  }
  return undefined;
}
