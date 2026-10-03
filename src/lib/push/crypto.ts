const encoder = new TextEncoder();

function owned(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", owned(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: owned(salt), info: owned(info) },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export async function vapidJwt(input: {
  audience: string;
  subject: string;
  publicKey: string;
  privateKey: string;
  expiresAt: number;
}): Promise<string> {
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToBase64Url(
    encoder.encode(
      JSON.stringify({ aud: input.audience, exp: input.expiresAt, sub: input.subject }),
    ),
  );
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await importVapidPrivate(input.publicKey, input.privateKey),
    encoder.encode(unsigned),
  );
  return `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function importVapidPrivate(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(publicKey);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("Invalid VAPID public key");
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToBase64Url(raw.slice(1, 33)),
      y: bytesToBase64Url(raw.slice(33, 65)),
      d: privateKey,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

export async function encryptWebPush(input: {
  plaintext: Uint8Array;
  userAgentPublicKey: Uint8Array;
  authenticationSecret: Uint8Array;
  salt: Uint8Array;
  asPublicKey: Uint8Array;
  asPrivateKey: CryptoKey;
}): Promise<Uint8Array> {
  const userKey = await crypto.subtle.importKey(
    "raw",
    owned(input.userAgentPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: userKey },
      input.asPrivateKey,
      256,
    ),
  );
  const keyInfo = concat(
    encoder.encode("WebPush: info"),
    new Uint8Array([0]),
    input.userAgentPublicKey,
    input.asPublicKey,
  );
  const ikm = await hkdf(input.authenticationSecret, shared, keyInfo, 32);
  const contentKey = await hkdf(
    input.salt,
    ikm,
    encoder.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdf(
    input.salt,
    ikm,
    encoder.encode("Content-Encoding: nonce\0"),
    12,
  );
  const padded = concat(input.plaintext, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey("raw", owned(contentKey), "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: owned(nonce) }, aes, owned(padded)),
  );
  const header = new Uint8Array(16 + 4 + 1 + input.asPublicKey.length);
  header.set(input.salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = input.asPublicKey.length;
  header.set(input.asPublicKey, 21);
  return concat(header, ciphertext);
}

export async function buildWebPushBody(input: {
  plaintext: string;
  p256dh: string;
  auth: string;
  localPublicKey?: Uint8Array;
  localPrivateKey?: CryptoKey;
  salt?: Uint8Array;
}): Promise<Uint8Array> {
  const local =
    input.localPublicKey && input.localPrivateKey && input.salt
      ? {
          publicKey: input.localPublicKey,
          privateKey: input.localPrivateKey,
          salt: input.salt,
        }
      : await ephemeralPushKey();
  return encryptWebPush({
    plaintext: encoder.encode(input.plaintext),
    userAgentPublicKey: base64UrlToBytes(input.p256dh),
    authenticationSecret: base64UrlToBytes(input.auth),
    salt: local.salt,
    asPublicKey: local.publicKey,
    asPrivateKey: local.privateKey,
  });
}

async function ephemeralPushKey() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    publicKey,
    privateKey: pair.privateKey,
    salt: crypto.getRandomValues(new Uint8Array(16)),
  };
}

export async function importEcdhPrivate(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(publicKey);
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToBase64Url(raw.slice(1, 33)),
      y: bytesToBase64Url(raw.slice(33, 65)),
      d: privateKey,
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
}
