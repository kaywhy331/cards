import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export function randomId(prefix = "id") {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function randomCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function hmacHex(secret, value) {
  return createHmac("sha256", String(secret)).update(String(value)).digest("hex");
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function secureEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 10) {
    throw new Error("Password must contain at least 10 characters.");
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, saltText, hashText] = String(encoded).split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(hashText, "base64url");
  const actual = Buffer.from(await scrypt(password, salt, expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  }));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function signObject(secret, payload) {
  return hmacHex(secret, stableStringify(payload));
}

export function verifyObjectSignature(secret, payload, signature) {
  return secureEqual(signObject(secret, payload), signature);
}

export function encryptString(masterKeyBase64, plaintext) {
  const key = Buffer.from(masterKeyBase64, "base64url");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: encrypted.toString("base64url"),
  };
}

export function decryptString(masterKeyBase64, envelope) {
  if (!envelope || envelope.algorithm !== "aes-256-gcm") throw new Error("Unsupported encrypted secret.");
  const key = Buffer.from(masterKeyBase64, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
