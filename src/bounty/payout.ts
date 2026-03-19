import type { Address } from "@tosnetwork/tosdk";
import { sendNativeTransfer } from "../chain/client.js";

export interface BountyPayoutSender {
  send(params: {
    to: Address;
    amountTomi: bigint;
  }): Promise<{ txHash: `0x${string}` | string }>;
}

export function createNativeBountyPayoutSender(params: {
  rpcUrl: string;
  privateKey: `0x${string}`;
}): BountyPayoutSender {
  return {
    async send({ to, amountTomi }) {
      const transfer = await sendNativeTransfer({
        rpcUrl: params.rpcUrl,
        privateKey: params.privateKey,
        to,
        amountTomi,
        waitForReceipt: false,
      });
      return { txHash: transfer.txHash };
    },
  };
}
