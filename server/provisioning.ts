import { createPublicKey, randomBytes, verify } from "node:crypto";

export function provisioningMessage(payload: {
  nonce: string;
  apiKey: string;
  flightApiKey?: string;
  accessToken: string;
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      purpose: "priceless-provision-v1",
      nonce: payload.nonce,
      apiKey: payload.apiKey,
      accessToken: payload.accessToken,
      flightApiKey: payload.flightApiKey,
    }),
  );
}

export class Provisioning {
  private nonces = new Map<string, number>();
  constructor(private ownerPublicKey?: string) {
    if (ownerPublicKey) createPublicKey(ownerPublicKey);
  }
  challenge(): string {
    if (!this.ownerPublicKey)
      throw new Error("Owner provisioning is not configured.");
    for (const [nonce, expiry] of this.nonces)
      if (expiry < Date.now()) this.nonces.delete(nonce);
    if (this.nonces.size >= 8)
      this.nonces.delete(this.nonces.keys().next().value!);
    const nonce = randomBytes(32).toString("hex");
    this.nonces.set(nonce, Date.now() + 60000);
    return nonce;
  }
  accept(input: {
    nonce: string;
    apiKey: string;
    flightApiKey?: string;
    accessToken: string;
    signature: string;
  }): boolean {
    if (!this.ownerPublicKey || !this.nonces.has(input.nonce)) return false;
    const expiry = this.nonces.get(input.nonce)!;
    this.nonces.delete(input.nonce);
    if (expiry < Date.now()) return false;
    return verify(
      null,
      provisioningMessage(input),
      this.ownerPublicKey,
      Buffer.from(input.signature, "base64"),
    );
  }
}
