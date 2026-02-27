import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const ESCROW_ABI = [
  {
    type: "function",
    name: "createDeal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "payee", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint64" },
      { name: "metaHash", type: "bytes32" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "ok", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "d", type: "uint8" }],
  },
] as const;

export interface ChainConfig {
  rpcUrl: string;
  signerPrivateKey: Hex;
  escrowAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
}

export function loadChainConfig(): ChainConfig {
  const rpcUrl = process.env.BASE_RPC_URL?.trim();
  if (!rpcUrl) throw new Error("BASE_RPC_URL is required");

  const pk = process.env.SIGNER_PRIVATE_KEY?.trim();
  if (!pk) throw new Error("SIGNER_PRIVATE_KEY is required");
  const signerPrivateKey = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;

  const escrowAddress = process.env.ESCROW_ADDRESS?.trim() as `0x${string}` | undefined;
  const usdcAddress = process.env.USDC_ADDRESS?.trim() as `0x${string}` | undefined;
  if (!escrowAddress) throw new Error("ESCROW_ADDRESS is required");
  if (!usdcAddress) throw new Error("USDC_ADDRESS is required");

  return { rpcUrl, signerPrivateKey, escrowAddress, usdcAddress };
}

export function makeClients(cfg: ChainConfig): {
  account: ReturnType<typeof privateKeyToAccount>;
  publicClient: PublicClient;
  walletClient: WalletClient;
} {
  const account = privateKeyToAccount(cfg.signerPrivateKey);

  // Note: we intentionally omit a concrete chain type here to avoid overly
  // strict transaction typing differences across L2s.
  const publicClient = createPublicClient({
    transport: http(cfg.rpcUrl),
  }) as unknown as PublicClient;

  const walletClient = createWalletClient({
    account,
    transport: http(cfg.rpcUrl),
  }) as unknown as WalletClient;

  return { account, publicClient, walletClient };
}

export async function usdcAmountToUnits(
  publicClient: ReturnType<typeof createPublicClient>,
  usdcAddress: `0x${string}`,
  amountDecimal: string,
): Promise<bigint> {
  // Prefer onchain decimals; fallback to 6.
  let decimals = 6;
  try {
    decimals = await publicClient.readContract({
      address: usdcAddress,
      abi: ERC20_ABI,
      functionName: "decimals",
    });
  } catch {
    // ignore
  }
  return parseUnits(amountDecimal, decimals);
}
