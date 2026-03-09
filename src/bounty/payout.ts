import type { Address } from "tosdk";
import { sendTOSNativeTransfer } from "../tos/client.js";

export interface BountyPayoutSender {
  send(params: {
    to: Address;
    amountWei: bigint;
  }): Promise<{ txHash: `0x${string}` | string }>;
}

export function createNativeBountyPayoutSender(params: {
  rpcUrl: string;
  privateKey: `0x${string}`;
}): BountyPayoutSender {
  return {
    async send({ to, amountWei }) {
      const transfer = await sendTOSNativeTransfer({
        rpcUrl: params.rpcUrl,
        privateKey: params.privateKey,
        to,
        amountWei,
        waitForReceipt: false,
      });
      return { txHash: transfer.txHash };
    },
  };
}
