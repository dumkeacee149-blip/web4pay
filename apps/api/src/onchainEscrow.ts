import type { Hex } from "viem";
import { decodeEventLog, keccak256, toHex } from "viem";
import { ESCROW_ABI } from "./onchain";

export function makeMetaHashFromQuoteHash(quoteHash: string): Hex {
  // quoteHash is already 0x + 32 bytes in our DB (sha256 hex), but keep it safe.
  if (/^0x[0-9a-fA-F]{64}$/.test(quoteHash)) return quoteHash as Hex;
  return keccak256(toHex(quoteHash));
}

export function extractDealCreatedIdFromReceipt(receipt: any): bigint {
  for (const log of receipt.logs ?? []) {
    try {
      const decoded = decodeEventLog({
        abi: ESCROW_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "DealCreated") {
        // @ts-ignore
        return decoded.args.id as bigint;
      }
    } catch {
      // ignore
    }
  }
  throw new Error("DealCreated event not found in tx receipt");
}
