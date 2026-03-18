import { createHash } from "crypto";
import net from "net";
import { URL } from "url";

export interface FetchBoundedUrlResult {
  url: string;
  canonicalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
  bodySha256: `0x${string}`;
}

export function isPrivateHost(hostname: string): boolean {
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

export function validateHttpTargetUrl(
  value: string,
  options?: { allowPrivateTargets?: boolean },
): URL {
  const targetUrl = new URL(value);
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    throw new Error("target URL must use http or https");
  }
  if (!options?.allowPrivateTargets && isPrivateHost(targetUrl.hostname)) {
    throw new Error("private target URLs are not allowed");
  }
  return targetUrl;
}

export async function fetchBoundedUrl(
  targetUrl: URL,
  options: { timeoutMs: number; maxResponseBytes: number; accept?: string },
): Promise<FetchBoundedUrlResult> {
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
    const bodySha256 = `0x${createHash("sha256").update(limited).digest("hex")}` as const;
    return {
      url: targetUrl.toString(),
      canonicalUrl: response.url || targetUrl.toString(),
      status: response.status,
      contentType: response.headers.get("content-type") || "application/octet-stream",
      body: limited,
      bodySha256,
    };
  } finally {
    clearTimeout(timer);
  }
}
