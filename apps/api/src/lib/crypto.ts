import { createHash, randomBytes } from "crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableSerialize(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).sort();
    const serializedEntries = keys
      .filter((key) => objectValue[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(objectValue[key])}`);
    return `{${serializedEntries.join(",")}}`;
  }

  return JSON.stringify(String(value));
}

export function stableStringify(value: unknown): string {
  return stableSerialize(value);
}

export function makeRequestHash(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function randomAddress(): string {
  return `0x${randomHex(20)}`;
}

export function randomTxHash(): string {
  return `0x${randomHex(32)}`;
}

export function randomUint64String(): string {
  return BigInt(`0x${randomHex(8)}`).toString(10);
}
