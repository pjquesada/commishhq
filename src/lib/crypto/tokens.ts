function owned(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}
function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function base64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  keyVersion: 1;
}

/** AES-GCM. The key is 32 raw bytes encoded as standard base64. */
export async function encryptSecret(plaintext: string, keyBase64: string): Promise<SealedSecret> {
  const raw = bytesFromBase64(keyBase64);
  if (raw.byteLength !== 32) throw new Error("Invalid token key");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, owned(new TextEncoder().encode(plaintext))),
  );
  return { ciphertext: base64(cipher), iv: base64(iv), keyVersion: 1 };
}

export async function decryptSecret(sealed: SealedSecret, keyBase64: string): Promise<string> {
  const raw = bytesFromBase64(keyBase64);
  if (raw.byteLength !== 32 || sealed.keyVersion !== 1) throw new Error("Invalid token key");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromBase64(sealed.iv) },
    key,
    bytesFromBase64(sealed.ciphertext),
  );
  return new TextDecoder().decode(plain);
}
