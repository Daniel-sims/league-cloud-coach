import { expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { encryptToken, decryptToken } from "./tokens";
const crypto = webcrypto as unknown as Crypto;
const secret = Buffer.alloc(32, 7).toString("base64");
it("round-trips encrypted tokens with fresh nonces and rejects tampering or wrong keys", async () => {
  const token = "RGAPI-test-token-private";
  const first = await encryptToken(token, secret, crypto),
    second = await encryptToken(token, secret, crypto);
  expect(first).not.toContain(token);
  expect(first).not.toBe(second);
  expect(await decryptToken(first, secret, crypto)).toBe(token);
  const bytes = Buffer.from(first, "base64");
  bytes[20] ^= 1;
  await expect(
    decryptToken(bytes.toString("base64"), secret, crypto),
  ).rejects.toThrow();
  await expect(
    decryptToken(first, Buffer.alloc(32, 8).toString("base64"), crypto),
  ).rejects.toThrow();
});
