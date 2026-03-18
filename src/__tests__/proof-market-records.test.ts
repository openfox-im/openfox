import { describe, expect, it } from "vitest";
import { createTestDb } from "./mocks.js";
import {
  buildProofVerificationSummary,
  buildZkTlsBundleSummary,
  getProofVerificationRecord,
  getZkTlsBundleRecord,
  storeProofVerificationRecord,
  storeZkTlsBundleRecord,
} from "../proof-market/records.js";

describe("proof market records", () => {
  it("stores zkTLS bundle records with origin claims and integrity hashes", () => {
    const db = createTestDb();
    storeZkTlsBundleRecord(db, {
      recordId: "zktls:1",
      jobId: "job-1",
      requestKey: "request-1",
      capability: "news.fetch",
      requesterIdentity: "tos:requester",
      providerBackend: {
        kind: "skills",
        stages: ["newsfetch.capture", "zktls.prove", "zktls.bundle"],
      },
      sourceUrl: "https://example.com/article",
      resultUrl: "/news/fetch/result/job-1",
      bundleUrl: "/news/fetch/bundle/job-1",
      attestationUrl: "/news/fetch/attestation/job-1",
      bundleFormat: "zktls_bundle_v1",
      verificationMode: "native_attestation",
      nativeProofStatus: "native_attested",
      zktlsAttestationSha256: `0x${"1".repeat(64)}`,
      originClaims: {
        sourceUrl: "https://example.com/article",
        canonicalUrl: "https://example.com/article",
        sourcePolicyId: "example-policy-v1",
        sourcePolicyHost: "example.com",
        publisherHint: "Example",
        headlineHint: "Example headline",
        publisher: "Example",
        headline: "Example headline",
        fetchedAt: 1773273600,
        httpStatus: 200,
        contentType: "text/html",
      },
      verifierMaterialReferences: [
        {
          kind: "tlsn.attestation",
          ref: "artifact://bundle/1",
          hash: `0x${"a".repeat(64)}`,
        },
      ],
      integrity: {
        bundleSha256: `0x${"b".repeat(64)}`,
        articleSha256: `0x${"c".repeat(64)}`,
        sourceResponseSha256: `0x${"d".repeat(64)}`,
      },
      bundle: { headline: "Example headline" },
      metadata: { provider_backend: "skills_first" },
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:00:00.000Z",
    });

    const stored = getZkTlsBundleRecord(db, "zktls:1");
    expect(stored?.originClaims.sourcePolicyId).toBe("example-policy-v1");
    expect(stored?.verifierMaterialReferences[0]?.kind).toBe("tlsn.attestation");
    expect(stored?.verificationMode).toBe("native_attestation");
    const summary = buildZkTlsBundleSummary(db, 10);
    expect(summary.totalBundles).toBe(1);
    expect(summary.nativeAttestedBundles).toBe(1);
    expect(summary.fallbackBundles).toBe(0);
    expect(summary.sourcePolicies["example-policy-v1"]).toBe(1);
    db.close();
  });

  it("stores proof verification records across fallback, native, and committee modes", () => {
    const db = createTestDb();
    storeProofVerificationRecord(db, {
      recordId: "proof:1",
      resultId: "result-1",
      requestKey: "request-1",
      capability: "proof.verify",
      requesterIdentity: "tos:requester",
      providerBackend: { kind: "builtin", stages: ["proofverify.verify"] },
      verifierClass: "bundle_integrity_verification",
      verificationMode: "fallback_integrity",
      verdict: "valid",
      verdictReason: "all_checks_passed",
      summary: "fallback verification succeeded",
      verifierReceiptSha256: `0x${"e".repeat(64)}`,
      verifierMaterialReference: {
        kind: "proof_bundle",
        ref: "https://example.com/bundle.json",
        hash: `0x${"f".repeat(64)}`,
      },
      boundSubjectHashes: {
        subjectSha256: `0x${"1".repeat(64)}`,
        bundleSha256: `0x${"2".repeat(64)}`,
        responseHash: `0x${"3".repeat(64)}`,
      },
      request: {
        subjectUrl: "https://example.com/article",
        proofBundleUrl: "https://example.com/bundle.json",
      },
      metadata: null,
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:00:00.000Z",
    });
    storeProofVerificationRecord(db, {
      recordId: "proof:2",
      resultId: "result-2",
      requestKey: "request-2",
      capability: "proof.verify",
      requesterIdentity: "tos:requester",
      providerBackend: {
        kind: "skills",
        stages: ["proofverify.verify-attestations", "proofverify.verify-consensus"],
      },
      verifierClass: "tlsnotary_attestation_verification",
      verificationMode: "native_attestation",
      verdict: "valid",
      verdictReason: "proof_verified",
      summary: "native attestation verification succeeded",
      verifierProfile: "tlsn.rust",
      verifierReceiptSha256: `0x${"4".repeat(64)}`,
      verifierMaterialReference: {
        kind: "tlsn.attestation",
        ref: "artifact://proof/1",
      },
      boundSubjectHashes: {
        subjectSha256: `0x${"5".repeat(64)}`,
        bundleSha256: `0x${"6".repeat(64)}`,
        responseHash: `0x${"7".repeat(64)}`,
      },
      request: {
        subjectUrl: "https://example.com/article",
        proofBundleUrl: "artifact://proof/1",
      },
      metadata: null,
      createdAt: "2026-03-12T00:01:00.000Z",
      updatedAt: "2026-03-12T00:01:00.000Z",
    });
    storeProofVerificationRecord(db, {
      recordId: "proof:3",
      resultId: "result-3",
      requestKey: "request-3",
      capability: "proof.verify",
      requesterIdentity: "tos:requester",
      providerBackend: {
        kind: "skills",
        stages: ["proofverify.verify-attestations", "proofverify.verify-consensus"],
      },
      verifierClass: "m_of_n_consensus_verification",
      verificationMode: "committee_verified",
      verdict: "valid",
      verdictReason: "committee_consensus_verdict",
      summary: "committee verification succeeded",
      verifierProfile: "tlsn.rust",
      verifierReceiptSha256: `0x${"8".repeat(64)}`,
      verifierMaterialReference: {
        kind: "committee.aggregate",
        ref: "artifact://committee/1",
      },
      boundSubjectHashes: {
        subjectSha256: `0x${"9".repeat(64)}`,
        bundleSha256: `0x${"a".repeat(64)}`,
        responseHash: `0x${"b".repeat(64)}`,
      },
      request: {
        subjectUrl: "https://example.com/article",
        proofBundleUrl: "artifact://committee/1",
      },
      metadata: null,
      createdAt: "2026-03-12T00:02:00.000Z",
      updatedAt: "2026-03-12T00:02:00.000Z",
    });

    expect(getProofVerificationRecord(db, "proof:2")?.verificationMode).toBe(
      "native_attestation",
    );
    const summary = buildProofVerificationSummary(db, 10);
    expect(summary.totalResults).toBe(3);
    expect(summary.fallbackIntegrityVerifications).toBe(1);
    expect(summary.nativeAttestationVerifications).toBe(1);
    expect(summary.committeeVerifiedResults).toBe(1);
    expect(summary.verifierClasses.tlsnotary_attestation_verification).toBe(1);
    expect(summary.verifierClasses.m_of_n_consensus_verification).toBe(1);
    db.close();
  });
});
