import { ApiError } from "./errors";

export function requireString(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, `Invalid ${name}`, {
      code: "invalid_request",
      detail: `${name} must be a non-empty string`,
    });
  }
  return value.trim();
}

export function requireInt(name: string, value: unknown, min: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw new ApiError(400, `Invalid ${name}`, {
      code: "invalid_request",
      detail: `${name} must be an integer >= ${min}`,
    });
  }
  return n;
}

export function requireAmount(value: unknown): string {
  const s = requireString("amount", value);
  // very light validation: digits with optional decimals
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new ApiError(400, "Invalid amount", {
      code: "invalid_request",
      detail: "amount must be a decimal string",
    });
  }
  return s;
}

export function requireEthAddress(name: string, value: unknown): string {
  const s = requireString(name, value);
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) {
    throw new ApiError(400, `Invalid ${name}`, {
      code: "invalid_request",
      detail: `${name} must be a 0x-prefixed 40-byte hex address`,
    });
  }
  return s;
}
