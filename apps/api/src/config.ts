import "dotenv/config";

export interface AppConfig {
  port: number;
  databaseUrl: string;
  apiKeys: Set<string>;
  /** If true, /v1/escrows will submit onchain txs. */
  onchainEnabled: boolean;
}

export function loadConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const apiKeys = new Set(
    (process.env.API_KEYS ?? "")
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean),
  );
  if (apiKeys.size === 0) {
    throw new Error("API_KEYS is required and must include at least one token");
  }

  const rawPort = process.env.PORT?.trim() || "3000";
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  const onchainEnabled = (process.env.ONCHAIN_ENABLED ?? "").trim() === "1";

  return {
    port,
    databaseUrl,
    apiKeys,
    onchainEnabled,
  };
}
