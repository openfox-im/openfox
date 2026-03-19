import fs from "fs";
import path from "path";
import { generateKeyPairSync } from "crypto";
import {
  createWalletClient,
  http as httpTransport,
  publicKeyToNativeAddress,
  signHash,
  hashTransaction,
  type Address,
  type LocalAccount,
  bls12381PrivateKeyToAccount,
  elgamalPrivateKeyToAccount,
  generatePrivateKey,
  secp256r1PrivateKeyToAccount,
} from "@tosnetwork/tosdk";
import type {
  FaucetInvocationRequest,
  FaucetInvocationResponse,
} from "../agent-discovery/types.js";
import { requestTestnetFaucet } from "../agent-discovery/client.js";
import { resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import {
  type OpenFoxConfig,
  type OpenFoxIdentity,
  type HexAddress,
} from "../types.js";
import { getWallet, getOpenFoxDir, loadWalletPrivateKey } from "../identity/wallet.js";
import {
  ChainRpcClient,
  type AccountProfile,
  type SignerProfile,
  formatNetwork,
  parseAmount,
  setSignerMetadata,
} from "../chain/client.js";
import { explainChainRpcError } from "../chain/errors.js";
import {
  deriveAddressFromPrivateKey,
  normalizeAddress,
  type ChainAddress,
} from "../chain/address.js";

export interface WalletStatusSnapshot {
  address: ChainAddress;
  rpcUrl?: string;
  chainId?: bigint;
  balanceTomi?: bigint;
  nonce?: bigint;
  signer?: SignerProfile["signer"];
  account?: AccountProfile;
}

export interface WalletLocalFundingResult {
  mode: "local";
  from: ChainAddress;
  to: ChainAddress;
  amountTomi: bigint;
  txHash: HexAddress;
}

export interface WalletTestnetFundingResult {
  mode: "testnet";
  to: ChainAddress;
  amountTomi: bigint;
  provider: string;
  txHash?: HexAddress;
  status: FaucetInvocationResponse["status"];
  reason?: string;
}

export interface WalletBootstrapResult {
  signerType: string;
  signerValue: HexAddress;
  txHash: HexAddress;
  keyPath?: string;
}

type BootstrapSignerType = "ed25519" | "secp256r1" | "bls12-381" | "elgamal";

interface SignerMaterial {
  type: BootstrapSignerType;
  publicKey: HexAddress;
  privateKey: HexAddress;
  createdAt: string;
}

function buildIdentity(config: OpenFoxConfig): Promise<{
  identity: OpenFoxIdentity;
  privateKey: `0x${string}`;
  address: ChainAddress;
}> {
  return getWallet().then(({ account, privateKey }) => {
    const address = (config.walletAddress ||
      deriveAddressFromPrivateKey(privateKey)) as ChainAddress;
    return {
      identity: {
        name: config.name,
        address,
        account,
        creatorAddress: config.creatorAddress,
        sandboxId: config.sandboxId || "",
        apiKey: config.runtimeApiKey || "",
        createdAt: new Date().toISOString(),
      },
      privateKey,
      address,
    };
  });
}

function base64UrlToHex(value: string): HexAddress {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4 || 4)) % 4)}`;
  return `0x${Buffer.from(padded, "base64").toString("hex")}` as HexAddress;
}

function createEd25519Account(params: {
  address: ChainAddress;
  publicKey: HexAddress;
  privateKey: HexAddress;
}): LocalAccount<"custom", Address> {
  return {
    address: params.address,
    publicKey: params.publicKey,
    signerType: "ed25519",
    source: "custom",
    type: "local",
    async sign() {
      throw new Error("raw ed25519 hash signing is not exposed through this OpenFox helper.");
    },
    async signMessage() {
      throw new Error("ed25519 signMessage is not exposed through this OpenFox helper.");
    },
    async signAuthorization(transaction) {
      return signHash({
        hash: hashTransaction(transaction),
        privateKey: params.privateKey,
        signerType: "ed25519",
        to: "object",
      });
    },
    async signTransaction() {
      throw new Error("ed25519 signTransaction is not exposed through this OpenFox helper.");
    },
    async signTypedData() {
      throw new Error("ed25519 signTypedData is not exposed through this OpenFox helper.");
    },
  };
}

function buildRequestExpiry(): number {
  return Math.floor(Date.now() / 1000) + 300;
}

async function requestTestnetFaucetViaUrl(params: {
  config: OpenFoxConfig;
  address: ChainAddress;
  amountTomi: bigint;
  faucetUrl: string;
  reason: string;
  waitForReceipt?: boolean;
}): Promise<WalletTestnetFundingResult> {
  const body: FaucetInvocationRequest = {
    capability: "sponsor.topup.testnet",
    requester: {
      agent_id: params.config.agentId || params.address.toLowerCase(),
      identity: { kind: "tos", value: params.address.toLowerCase() },
    },
    request_nonce: Math.random().toString(16).slice(2) + Date.now().toString(16),
    request_expires_at: buildRequestExpiry(),
    requested_amount: params.amountTomi.toString(),
    reason: params.reason,
  };

  const response = await fetch(params.faucetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as FaucetInvocationResponse;
  if (!payload || typeof payload.status !== "string") {
    throw new Error("Testnet faucet returned an invalid response.");
  }

  if (
    params.waitForReceipt &&
    payload.tx_hash &&
    params.config.rpcUrl &&
    payload.status === "approved"
  ) {
    const client = new ChainRpcClient({ rpcUrl: params.config.rpcUrl });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const receipt = await client.getTransactionReceipt(payload.tx_hash as HexAddress);
      if (receipt) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  return {
    mode: "testnet",
    to: params.address,
    amountTomi: params.amountTomi,
    provider: params.faucetUrl,
    txHash: payload.tx_hash as HexAddress | undefined,
    status: payload.status,
    reason: payload.reason,
  };
}

export async function buildWalletStatusSnapshot(
  config: OpenFoxConfig,
): Promise<WalletStatusSnapshot> {
  const { address } = await buildIdentity(config);
  const rpcUrl = config.rpcUrl || process.env.TOS_RPC_URL;
  if (!rpcUrl) {
    return { address };
  }
  const client = new ChainRpcClient({ rpcUrl });
  const [chainId, account, signer] = await Promise.all([
    client.getChainId(),
    client.getAccount(address),
    client.getSigner(address),
  ]);
  return {
    address,
    rpcUrl,
    chainId,
    balanceTomi: account.balance,
    nonce: account.nonce,
    signer: signer.signer,
    account,
  };
}

export function formatWalletStatusReport(snapshot: WalletStatusSnapshot): string {
  return [
    "=== OPENFOX WALLET ===",
    `Address: ${snapshot.address}`,
    `RPC: ${snapshot.rpcUrl || "(unset)"}`,
    `Network: ${snapshot.chainId !== undefined ? formatNetwork(snapshot.chainId) : "(unknown)"}`,
    `Balance: ${snapshot.balanceTomi !== undefined ? snapshot.balanceTomi.toString() : "(unknown)"} tomi`,
    `Pending nonce: ${snapshot.nonce !== undefined ? snapshot.nonce.toString() : "(unknown)"}`,
    `Signer type: ${snapshot.signer?.type || "(unknown)"}`,
    `Signer value: ${snapshot.signer?.value || "(unknown)"}`,
    `Signer defaulted: ${snapshot.signer ? (snapshot.signer.defaulted ? "yes" : "no") : "(unknown)"}`,
  ].join("\n");
}

export async function fundWalletFromLocalDevnet(params: {
  config: OpenFoxConfig;
  amountTomi?: bigint;
  from?: ChainAddress | string;
  password?: string;
  waitForReceipt?: boolean;
}): Promise<WalletLocalFundingResult> {
  const { address } = await buildIdentity(params.config);
  const rpcUrl = params.config.rpcUrl || process.env.TOS_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Local devnet funding requires rpcUrl.");
  }
  const client = new ChainRpcClient({ rpcUrl });
  let from = params.from || params.config.walletFunding?.localFunderAddress;
  if (!from) {
    try {
      from = (await client.listAccounts())[0];
    } catch {
      from = undefined;
    }
  }
  if (!from) {
    try {
      from = (await client.listPersonalAccounts())[0];
    } catch {
      from = undefined;
    }
  }
  if (!from) {
    throw new Error(
      "No local funding account is available on this node. Configure walletFunding.localFunderAddress or expose tos_accounts on the local node.",
    );
  }
  const amountTomi =
    params.amountTomi ||
    BigInt(
      params.config.walletFunding?.localDefaultAmountTomi || "5000000000000000000",
    );
  const normalizedFrom = normalizeAddress(from);
  let txHash: HexAddress;
  try {
    txHash = await client.sendManagedTransaction({
      from: normalizedFrom,
      to: address,
      value: amountTomi,
      gas: 21_000n,
    });
  } catch (error) {
    txHash = await client.sendPersonalTransaction({
      from: normalizedFrom,
      to: address,
      value: amountTomi,
      gas: 21_000n,
      password:
        params.password ??
        params.config.walletFunding?.localFunderPassword ??
        process.env.OPENFOX_LOCAL_FUNDER_PASSWORD ??
        "",
    });
  }

  if (params.waitForReceipt) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const receipt = await client.getTransactionReceipt(txHash);
      if (receipt) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  return {
    mode: "local",
    from: normalizedFrom,
    to: address,
    amountTomi,
    txHash,
  };
}

export async function fundWalletFromTestnet(params: {
  config: OpenFoxConfig;
  amountTomi?: bigint;
  faucetUrl?: string;
  reason?: string;
  waitForReceipt?: boolean;
}): Promise<WalletTestnetFundingResult> {
  const { identity, address } = await buildIdentity(params.config);
  const amountTomi =
    params.amountTomi ||
    BigInt(
      params.config.walletFunding?.testnetDefaultAmountTomi || "10000000000000000",
    );
  const reason =
    params.reason ||
    params.config.walletFunding?.testnetReason ||
    "bootstrap openfox wallet";
  const faucetUrl =
    params.faucetUrl ||
    params.config.walletFunding?.testnetFaucetUrl ||
    process.env.OPENFOX_TESTNET_FAUCET_URL;

  if (faucetUrl) {
    return requestTestnetFaucetViaUrl({
      config: params.config,
      address,
      amountTomi,
      faucetUrl,
      reason,
      waitForReceipt: params.waitForReceipt,
    });
  }

  const db = createDatabase(resolvePath(params.config.dbPath));
  try {
    const result = await requestTestnetFaucet({
      identity,
      config: params.config,
      address,
      requestedAmountTomi: amountTomi,
      reason,
      waitForReceipt: params.waitForReceipt,
      db,
    });
    return {
      mode: "testnet",
      to: address,
      amountTomi,
      provider: result.provider.endpoint.url,
      txHash: result.response.tx_hash as HexAddress | undefined,
      status: result.response.status,
      reason: result.response.reason,
    };
  } finally {
    db.close();
  }
}

function normalizeBootstrapSignerType(value: string | undefined): BootstrapSignerType {
  const normalized = (value || "ed25519").trim().toLowerCase();
  if (normalized === "bls12381") return "bls12-381";
  if (
    normalized === "ed25519" ||
    normalized === "secp256r1" ||
    normalized === "bls12-381" ||
    normalized === "elgamal"
  ) {
    return normalized;
  }
  throw new Error(`Unsupported signer type: ${value || "undefined"}`);
}

function writeSignerMaterial(params: {
  material: SignerMaterial;
  outputPath?: string;
  overwrite?: boolean;
}): WalletBootstrapResult & { privateKey: HexAddress } {
  const outputPath =
    params.outputPath ||
    path.join(getOpenFoxDir(), "signers", `${params.material.type}.json`);
  if (fs.existsSync(outputPath) && !params.overwrite) {
    throw new Error(`Signer file already exists at ${outputPath}`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputPath, JSON.stringify(params.material, null, 2), {
    mode: 0o600,
  });

  return {
    signerType: params.material.type,
    signerValue: params.material.publicKey,
    privateKey: params.material.privateKey,
    txHash: "0x" as HexAddress,
    keyPath: outputPath,
  };
}

function generateNativeSignerMaterial(
  signerType: Exclude<BootstrapSignerType, "ed25519">,
): SignerMaterial {
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const privateKey = generatePrivateKey() as HexAddress;
    try {
      const account =
        signerType === "secp256r1"
          ? secp256r1PrivateKeyToAccount(privateKey)
          : signerType === "bls12-381"
            ? bls12381PrivateKeyToAccount(privateKey)
            : elgamalPrivateKeyToAccount(privateKey);
      return {
        type: signerType,
        publicKey: account.publicKey as HexAddress,
        privateKey,
        createdAt: new Date().toISOString(),
      };
    } catch {
      continue;
    }
  }
  throw new Error(`Failed to generate ${signerType} signer material.`);
}

export function generateSignerMaterial(params: {
  signerType: BootstrapSignerType;
  outputPath?: string;
  overwrite?: boolean;
}): WalletBootstrapResult & { privateKey: HexAddress } {
  if (params.signerType === "ed25519") {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
    const privateJwk = privateKey.export({ format: "jwk" }) as JsonWebKey;
    if (!publicJwk.x || !privateJwk.d) {
      throw new Error("Failed to export ed25519 signer material.");
    }
    return writeSignerMaterial({
      material: {
        type: "ed25519",
        publicKey: base64UrlToHex(publicJwk.x),
        privateKey: base64UrlToHex(privateJwk.d),
        createdAt: new Date().toISOString(),
      },
      outputPath: params.outputPath,
      overwrite: params.overwrite,
    });
  }

  return writeSignerMaterial({
    material: generateNativeSignerMaterial(params.signerType),
    outputPath: params.outputPath,
    overwrite: params.overwrite,
  });
}

export async function bootstrapWalletSigner(params: {
  config: OpenFoxConfig;
  signerType: BootstrapSignerType;
  signerValue?: HexAddress;
  signerPrivateKey?: HexAddress;
  generate?: boolean;
  outputPath?: string;
  overwrite?: boolean;
  waitForReceipt?: boolean;
}): Promise<WalletBootstrapResult> {
  const rpcUrl = params.config.rpcUrl || process.env.TOS_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Signer bootstrap requires rpcUrl.");
  }
  const walletPrivateKey = loadWalletPrivateKey();
  if (!walletPrivateKey) {
    throw new Error("OpenFox wallet is missing.");
  }
  const { address } = await buildIdentity(params.config);

  const signerType = normalizeBootstrapSignerType(params.signerType);
  let signerValue = params.signerValue;
  let signerPrivateKey = params.signerPrivateKey;
  let keyPath: string | undefined;
  if (!signerValue && params.generate !== false) {
    const generated = generateSignerMaterial({
      signerType,
      outputPath: params.outputPath,
      overwrite: params.overwrite,
    });
    signerValue = generated.signerValue;
    signerPrivateKey = generated.privateKey;
    keyPath = generated.keyPath;
  }
  if (!signerValue) {
    throw new Error("Provide --public-key or use --generate for signer bootstrap.");
  }

  if (!signerPrivateKey) {
    throw new Error(
      "Non-secp signer bootstrap requires signer private key material. Use --generate or provide --private-key.",
    );
  }

  const derivedAddress = normalizeAddress(
    publicKeyToNativeAddress({
      publicKey: signerValue,
      signerType,
    }),
  );
  if (derivedAddress !== address) {
    throw new Error(
      `Signer public key derives to ${derivedAddress}, but the configured wallet address is ${address}. Non-secp signer bootstrap only works when the wallet address already matches the signer-derived address.`,
    );
  }

  const account =
    signerType === "ed25519"
      ? createEd25519Account({
          address,
          publicKey: signerValue,
          privateKey: signerPrivateKey,
        })
      : signerType === "secp256r1"
        ? secp256r1PrivateKeyToAccount(signerPrivateKey)
        : signerType === "bls12-381"
          ? bls12381PrivateKeyToAccount(signerPrivateKey)
          : elgamalPrivateKeyToAccount(signerPrivateKey);

  const client = createWalletClient({
    account,
    transport: httpTransport(rpcUrl),
  });
  const txHash = await client.setSignerMetadata({
    signerType,
    signerValue,
  });
  return {
    signerType,
    signerValue,
    txHash: txHash as HexAddress,
    keyPath,
  };
}

export function formatWalletOperationError(error: unknown): string {
  const explanation = explainChainRpcError(error);
  return `${explanation.summary}\n${explanation.recommendation}`;
}
