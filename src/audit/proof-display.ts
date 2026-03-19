/**
 * Proof Reference Display
 *
 * GTOS 2046: Format proof references for display across owner/operator
 * views. Every externalized action should have its proof chain visible.
 */

import type { ExecutionReceipt } from "../intent/types.js";
import type { ProofRef } from "./replay.js";

// ── Types ────────────────────────────────────────────────────────

export interface ProofDisplay {
  title: string;
  type: string;
  hash: string;
  details: Record<string, string>;
  verifiable: boolean;
  explorerUrl?: string;
}

// ── Default explorer base URL (Ethereum mainnet) ─────────────────

const DEFAULT_EXPLORER_BASE = "https://etherscan.io";

// ── Functions ────────────────────────────────────────────────────

/** Format a single proof reference into a display object. */
export function formatProofRef(ref: ProofRef, explorerBase?: string): ProofDisplay {
  const base = explorerBase ?? DEFAULT_EXPLORER_BASE;
  const details: Record<string, string> = {};

  if (ref.blockNumber != null) {
    details["Block Number"] = ref.blockNumber.toString();
  }
  if (ref.uri) {
    details["URI"] = ref.uri;
  }

  let title: string;
  let verifiable: boolean;
  let explorerUrl: string | undefined;

  switch (ref.type) {
    case "tx_receipt":
      title = "Transaction Receipt";
      verifiable = true;
      explorerUrl = `${base}/tx/${ref.hash}`;
      details["Tx Hash"] = ref.hash;
      break;

    case "policy_decision":
      title = "Policy Decision";
      verifiable = true;
      details["Policy Hash"] = ref.hash;
      break;

    case "sponsor_auth":
      title = "Sponsor Authorization";
      verifiable = true;
      details["Auth Hash"] = ref.hash;
      break;

    case "settlement":
      title = "Settlement Confirmation";
      verifiable = true;
      explorerUrl = `${base}/tx/${ref.hash}`;
      details["Tx Hash"] = ref.hash;
      if (ref.blockNumber != null) {
        explorerUrl = `${base}/tx/${ref.hash}`;
        details["Block URL"] = `${base}/block/${ref.blockNumber}`;
      }
      break;

    case "session":
      title = "Terminal Session";
      verifiable = false;
      details["Session Ref"] = ref.hash;
      break;

    default:
      title = "Proof Reference";
      verifiable = false;
      details["Hash"] = ref.hash;
      break;
  }

  details["Description"] = ref.description;

  return {
    title,
    type: ref.type,
    hash: ref.hash,
    details,
    verifiable,
    explorerUrl,
  };
}

/** Collect and format all proofs for an execution receipt. */
export function formatExecutionProofs(
  receipt: ExecutionReceipt,
  proofs: ProofRef[],
  explorerBase?: string,
): ProofDisplay[] {
  const displays: ProofDisplay[] = [];

  // Always include the primary transaction proof
  const primaryTx: ProofDisplay = {
    title: "Primary Transaction",
    type: "tx_receipt",
    hash: receipt.txHash,
    details: {
      "Receipt ID": receipt.receiptId,
      "Tx Hash": receipt.txHash,
      "Block Number": receipt.blockNumber.toString(),
      "Block Hash": receipt.blockHash,
      "From": receipt.from,
      "To": receipt.to,
      "Value": `${receipt.value} tomi`,
      "Gas Used": receipt.gasUsed.toString(),
      "Status": receipt.receiptStatus,
      "Settled At": formatTimestamp(receipt.settledAt),
    },
    verifiable: true,
    explorerUrl: `${explorerBase ?? DEFAULT_EXPLORER_BASE}/tx/${receipt.txHash}`,
  };

  if (receipt.sponsor) {
    primaryTx.details["Sponsor"] = receipt.sponsor;
  }
  if (receipt.proofRef) {
    primaryTx.details["Proof Ref"] = receipt.proofRef;
  }
  if (receipt.effectsHash) {
    primaryTx.details["Effects Hash"] = receipt.effectsHash;
  }

  displays.push(primaryTx);

  // Format remaining proof references, skipping duplicates of the primary tx
  for (const proof of proofs) {
    if (proof.type === "tx_receipt" && proof.hash === receipt.txHash) {
      continue; // already covered by primary tx display
    }
    if (proof.type === "settlement" && proof.hash === receipt.txHash) {
      continue; // already covered by primary tx display
    }
    displays.push(formatProofRef(proof, explorerBase));
  }

  return displays;
}

/** Generate a human-readable proof summary for owner/operator view. */
export function generateProofSummary(proofs: ProofDisplay[]): string {
  const lines: string[] = [];

  lines.push(`=== Proof Summary (${proofs.length} reference${proofs.length !== 1 ? "s" : ""}) ===`);
  lines.push("");

  const verifiableCount = proofs.filter((p) => p.verifiable).length;
  lines.push(`Verifiable: ${verifiableCount}/${proofs.length}`);
  lines.push("");

  for (let i = 0; i < proofs.length; i++) {
    const proof = proofs[i];
    const idx = i + 1;
    const verifyTag = proof.verifiable ? "[verifiable]" : "[non-verifiable]";
    lines.push(`${idx}. ${proof.title} ${verifyTag}`);
    lines.push(`   Type: ${proof.type}`);
    lines.push(`   Hash: ${proof.hash}`);

    for (const [key, value] of Object.entries(proof.details)) {
      if (key === "Description") continue; // show last
      lines.push(`   ${key}: ${value}`);
    }
    if (proof.details["Description"]) {
      lines.push(`   Description: ${proof.details["Description"]}`);
    }
    if (proof.explorerUrl) {
      lines.push(`   Explorer: ${proof.explorerUrl}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Utility ──────────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}
