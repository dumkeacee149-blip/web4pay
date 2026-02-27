import { randomBytes } from "node:crypto";

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function fakeTxHash(): string {
  return `0x${randomHex(32)}`;
}

export function fakeAddress(): string {
  return `0x${randomHex(20)}`;
}
