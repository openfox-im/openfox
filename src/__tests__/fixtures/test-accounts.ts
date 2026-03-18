/**
 * Deterministic test accounts derived from secp256k1 key pairs.
 *
 * Each account has a real private key and a real 32-byte TOS address
 * derived via keccak256(uncompressed_pubkey). These replace the old
 * repeated-character placeholder addresses (0xaaaa..., 0x1111..., etc.)
 * to improve test credibility.
 *
 * Seeds are SHA-256("test-account-<nato>") used as private keys.
 */

import type { HexString } from "../../chain/address.js";
import type { ChainAddress } from "../../chain/address.js";

export interface TestAccount {
  /** Human-readable label */
  label: string;
  /** secp256k1 private key (hex) */
  privateKey: HexString;
  /** 32-byte TOS chain address derived from the private key */
  address: ChainAddress;
}

/** General-purpose test account A — use for wallet owner, payer, provider */
export const ACCOUNT_ALPHA: TestAccount = {
  label: "alpha",
  privateKey: "0xa083fc8f12f3140ad310e5d250520e20542fda4618147c4bfbedde17e4243c0e",
  address: "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
};

/** General-purpose test account B — use for counterparty, sponsor, requester */
export const ACCOUNT_BRAVO: TestAccount = {
  label: "bravo",
  privateKey: "0x9cde64a2633f14f7400afe2cab9bbb6dc3fc25477ab04820eaa066458d394bd9",
  address: "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
};

/** General-purpose test account C — use for third party, solver, target */
export const ACCOUNT_CHARLIE: TestAccount = {
  label: "charlie",
  privateKey: "0x4f152c697d25001f2ec4366b288a813e16e44a84f4ccfc710748ffe3cf401040",
  address: "0xc9b7083ed72ae7501f0f76c6fa2737ea3643ce0a7c85b2d81f4a2d030aea04ed",
};

/** General-purpose test account D — use for delegate, committee member */
export const ACCOUNT_DELTA: TestAccount = {
  label: "delta",
  privateKey: "0x453032034442a425d97268b7b4370f497f0f462cdc7cfeaf337972c246339b1e",
  address: "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
};

/** General-purpose test account E — use for secondary signer, observer */
export const ACCOUNT_ECHO: TestAccount = {
  label: "echo",
  privateKey: "0x3bda54a44a72afe9a334874ce0e06c9c128bcd271d33801a24425b53a8d7b6ce",
  address: "0x976eafa23799bc976e0d3da2d651f1caac6b3bcc292380de921560142fbba9e6",
};

/** General-purpose test account F — use for gateway, relay */
export const ACCOUNT_FOXTROT: TestAccount = {
  label: "foxtrot",
  privateKey: "0xcdfc16d6cdd220b02e237757f5b861fbb6c70a71af2c0fccca85547e2ade13ce",
  address: "0xfb43d57082cdcd5103e2d7593ab60734eeee43e7c023635d644c37105b69c022",
};

/** General-purpose test account G — use for storage provider */
export const ACCOUNT_GOLF: TestAccount = {
  label: "golf",
  privateKey: "0xeeeaafd3d2c7e09e4a31a9f07b29cc5f030d3cc22d8a36a9f03e05f10690a5dc",
  address: "0xb20d45fcf230c1d4053087f6df71ef5a43960ff5f61d976acb1fcfb4c40d9a10",
};

/** General-purpose test account H — use for paymaster, operator */
export const ACCOUNT_HOTEL: TestAccount = {
  label: "hotel",
  privateKey: "0xb87e5d70ae3183026d8ec61b46ea11b879f52076e17c19f2166d3971193e5d1c",
  address: "0xffd5a4c82ff6c618d999d2315b4ffa704f7689e5b9f02d3597591aa4ef4b6b09",
};

/** General-purpose test account I — use for bounty host */
export const ACCOUNT_INDIA: TestAccount = {
  label: "india",
  privateKey: "0x738835b6a9f3d4155ff5968fdbf0d6d9f2b0d44884179f17d167833be85883b7",
  address: "0x74ad93496274ddc81b6336c6fb3f32e17127f96a57dfafa05d87eadcb40b4d01",
};

/** General-purpose test account J — use for additional counterparty */
export const ACCOUNT_JULIET: TestAccount = {
  label: "juliet",
  privateKey: "0xdd4c359a8b299e8cc705a703a2148378713315d626305678012752bfa034ba57",
  address: "0xa65c6a8098b54b791cf3a2582b3e07b704d087d56f8f8fbdba35995dae0b8241",
};

/**
 * All test accounts in an array for iteration.
 * Index order: alpha(0), bravo(1), charlie(2), delta(3), echo(4),
 *              foxtrot(5), golf(6), hotel(7), india(8), juliet(9)
 */
export const ALL_TEST_ACCOUNTS: readonly TestAccount[] = [
  ACCOUNT_ALPHA,
  ACCOUNT_BRAVO,
  ACCOUNT_CHARLIE,
  ACCOUNT_DELTA,
  ACCOUNT_ECHO,
  ACCOUNT_FOXTROT,
  ACCOUNT_GOLF,
  ACCOUNT_HOTEL,
  ACCOUNT_INDIA,
  ACCOUNT_JULIET,
];
