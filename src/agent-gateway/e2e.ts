import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHash,
  randomBytes,
} from "crypto";

export const AGENT_GATEWAY_E2E_HEADER = "x-openfox-relay-e2e";
export const AGENT_GATEWAY_E2E_RESPONSE_HEADER =
  "x-openfox-relay-e2e-response";
export const AGENT_GATEWAY_E2E_SCHEME = "secp256k1-aes256gcm-v1";

export interface AgentGatewayEncryptedEnvelope {
  version: 1;
  scheme: typeof AGENT_GATEWAY_E2E_SCHEME;
  ephemeral_pubkey: `0x${string}`;
  iv: `0x${string}`;
  tag: `0x${string}`;
  ciphertext: `0x${string}`;
}

export interface PreparedAgentGatewayEncryptedRequest {
  envelope: AgentGatewayEncryptedEnvelope;
  responsePrivateKey: `0x${string}`;
}

function bytesToHex(bytes: Buffer | Uint8Array): `0x${string}` {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function hexToBuffer(value: `0x${string}` | string): Buffer {
  return Buffer.from(value.slice(2), "hex");
}

function deriveSymmetricKey(sharedSecret: Buffer): Buffer {
  return createHash("sha256").update(sharedSecret).digest();
}

export function encryptAgentGatewayPayload(params: {
  plaintext: Buffer;
  recipientPublicKey: `0x${string}`;
}): AgentGatewayEncryptedEnvelope {
  return prepareAgentGatewayEncryptedRequest(params).envelope;
}

export function prepareAgentGatewayEncryptedRequest(params: {
  plaintext: Buffer;
  recipientPublicKey: `0x${string}`;
}): PreparedAgentGatewayEncryptedRequest {
  const ecdh = createECDH("secp256k1");
  ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(
    hexToBuffer(params.recipientPublicKey),
  );
  const key = deriveSymmetricKey(sharedSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(params.plaintext),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    envelope: {
      version: 1,
      scheme: AGENT_GATEWAY_E2E_SCHEME,
      ephemeral_pubkey: bytesToHex(ecdh.getPublicKey(null, "uncompressed")),
      iv: bytesToHex(iv),
      tag: bytesToHex(tag),
      ciphertext: bytesToHex(ciphertext),
    },
    responsePrivateKey: bytesToHex(ecdh.getPrivateKey()),
  };
}

export function decryptAgentGatewayPayload(params: {
  envelope: AgentGatewayEncryptedEnvelope;
  recipientPrivateKey: `0x${string}`;
}): Buffer {
  if (params.envelope.version !== 1) {
    throw new Error("unsupported encrypted envelope version");
  }
  if (params.envelope.scheme !== AGENT_GATEWAY_E2E_SCHEME) {
    throw new Error("unsupported encrypted envelope scheme");
  }
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(hexToBuffer(params.recipientPrivateKey));
  const sharedSecret = ecdh.computeSecret(
    hexToBuffer(params.envelope.ephemeral_pubkey),
  );
  const key = deriveSymmetricKey(sharedSecret);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    hexToBuffer(params.envelope.iv),
  );
  decipher.setAuthTag(hexToBuffer(params.envelope.tag));
  return Buffer.concat([
    decipher.update(hexToBuffer(params.envelope.ciphertext)),
    decipher.final(),
  ]);
}

export function maybeDecryptAgentGatewayResponse(params: {
  value: unknown;
  responsePrivateKey?: `0x${string}`;
}): unknown {
  if (!params.responsePrivateKey) {
    return params.value;
  }
  if (!params.value || typeof params.value !== "object") {
    return params.value;
  }
  const envelope = params.value as Partial<AgentGatewayEncryptedEnvelope>;
  if (
    envelope.version !== 1 ||
    envelope.scheme !== AGENT_GATEWAY_E2E_SCHEME ||
    typeof envelope.ephemeral_pubkey !== "string" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.tag !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    return params.value;
  }
  const plaintext = decryptAgentGatewayPayload({
    envelope: envelope as AgentGatewayEncryptedEnvelope,
    recipientPrivateKey: params.responsePrivateKey,
  });
  const json = plaintext.toString("utf8");
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}
