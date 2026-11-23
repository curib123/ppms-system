/** Secure UUIDv4 identifiers, including browsers without Crypto.randomUUID. */
export function createUuid() {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  if (typeof source?.getRandomValues !== "function") {
    const code = "SECURE_RANDOM_UNAVAILABLE";
    throw Object.assign(new Error(code), { code, error: code });
  }

  // getRandomValues remains available on HTTP origins where randomUUID is not.
  // Never substitute timestamps or Math.random for record or idempotency IDs.
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}
