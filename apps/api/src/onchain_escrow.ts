import type { Address, Hash, PublicClient, WalletClient } from "viem";
import { keccak256, toHex } from "viem";
import { ESCROW_ABI, ERC20_ABI, usdcAmountToUnits } from "./onchain";

export function quoteIdToMetaHash(quoteId: string): `0x${string}` {
  // Make a deterministic bytes32 from the quoteId string.
  return keccak256(toHex(quoteId));
}

export async function createDealApproveDeposit(params: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  escrowAddress: Address;
  usdcAddress: Address;
  payeeAddress: Address;
  amountDecimal: string;
  deadlineAt: Date;
  quoteId: string;
}): Promise<{ dealId: bigint; txHash: Hash }> {
  const {
    publicClient,
    walletClient,
    escrowAddress,
    usdcAddress,
    payeeAddress,
    amountDecimal,
    deadlineAt,
    quoteId,
  } = params;

  const amountUnits = await usdcAmountToUnits(publicClient as any, usdcAddress as any, amountDecimal);
  const deadlineSec = BigInt(Math.floor(deadlineAt.getTime() / 1000));
  const metaHash = quoteIdToMetaHash(quoteId);

  // simulate createDeal to retrieve the deal id
  const simCreate = await (publicClient as any).simulateContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: "createDeal",
    args: [payeeAddress, amountUnits, Number(deadlineSec), metaHash],
    account: (walletClient as any).account,
  });

  const dealId: bigint = simCreate.result as bigint;
  const createHash: Hash = await (walletClient as any).writeContract(simCreate.request);
  await (publicClient as any).waitForTransactionReceipt({ hash: createHash });

  // approve escrow to pull USDC
  const simApprove = await (publicClient as any).simulateContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [escrowAddress, amountUnits],
    account: (walletClient as any).account,
  });
  const approveHash: Hash = await (walletClient as any).writeContract(simApprove.request);
  await (publicClient as any).waitForTransactionReceipt({ hash: approveHash });

  // deposit
  const simDeposit = await (publicClient as any).simulateContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: "deposit",
    args: [dealId],
    account: (walletClient as any).account,
  });
  const depositHash: Hash = await (walletClient as any).writeContract(simDeposit.request);
  await (publicClient as any).waitForTransactionReceipt({ hash: depositHash });

  return { dealId, txHash: depositHash };
}
