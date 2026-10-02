import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { outsideRepository } from "./paths.js";

export type Purpose = "backup" | "sync";
type Envelope = {
  format: "life-os-sealed";
  version: 1;
  purpose: Purpose;
  cipher: "aes-256-gcm";
  nonce: string;
  tag: string;
  ciphertext: string;
};
const header = (purpose: Purpose) => ({
  format: "life-os-sealed" as const,
  version: 1 as const,
  purpose,
  cipher: "aes-256-gcm" as const,
});
export function createKeyFile(path: string) {
  writeFileSync(outsideRepository(path), randomBytes(32), {
    flag: "wx",
    mode: 0o600,
  });
}
export function readKeyFile(path: string) {
  const fd = openSync(
    outsideRepository(path),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size !== 32 || (stat.mode & 0o077) !== 0)
      throw Error("Key must be a private 32-byte file (chmod 600)");
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function seal(value: unknown, purpose: Purpose, key: Buffer): Envelope {
  if (key.length !== 32) throw Error("Invalid key length");
  const nonce = randomBytes(12),
    metadata = header(purpose);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, {
    authTagLength: 16,
  });
  cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    ...metadata,
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
export function unseal<T>(value: unknown, purpose: Purpose, key: Buffer): T {
  const e = value as Envelope;
  if (
    !e ||
    e.format !== "life-os-sealed" ||
    e.version !== 1 ||
    e.purpose !== purpose ||
    e.cipher !== "aes-256-gcm" ||
    key.length !== 32
  )
    throw Error("Unsupported encrypted envelope or purpose");
  const decode = (s: string) => {
    if (typeof s !== "string" || s.length > 100_000_000)
      throw Error("Invalid encrypted envelope");
    const bytes = Buffer.from(s, "base64");
    if (bytes.toString("base64") !== s)
      throw Error("Invalid encrypted envelope");
    return bytes;
  };
  const nonce = decode(e.nonce),
    tag = decode(e.tag),
    ciphertext = decode(e.ciphertext);
  if (nonce.length !== 12 || tag.length !== 16)
    throw Error("Invalid encrypted envelope");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, {
      authTagLength: 16,
    });
    decipher.setAAD(Buffer.from(JSON.stringify(header(purpose))));
    decipher.setAuthTag(tag);
    const cleartext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(cleartext.toString("utf8")) as T;
  } catch {
    throw Error("Encrypted envelope authentication failed; no data imported");
  }
}
