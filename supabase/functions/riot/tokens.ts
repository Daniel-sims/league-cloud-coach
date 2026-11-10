// AES-GCM uses a fresh nonce for each save. The encryption key lives only in
// edge secrets; database snapshots contain ciphertext rather than Riot tokens.
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function decode(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
async function encryptionKey(secret: string, crypto: Crypto) {
  const raw = decode(secret);
  if (raw.length !== 32) throw new Error("Invalid encryption configuration");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encryptToken(
  token: string,
  secret: string,
  crypto: Crypto = globalThis.crypto,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret, crypto),
    new TextEncoder().encode(token),
  );
  const envelope = new Uint8Array(iv.length + cipher.byteLength);
  envelope.set(iv);
  envelope.set(new Uint8Array(cipher), iv.length);
  return encode(envelope);
}
export async function decryptToken(
  value: string,
  secret: string,
  crypto: Crypto = globalThis.crypto,
) {
  const envelope = decode(value);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: envelope.slice(0, 12) },
    await encryptionKey(secret, crypto),
    envelope.slice(12),
  );
  return new TextDecoder().decode(plain);
}
