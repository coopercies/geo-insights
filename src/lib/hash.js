// Content hashing for datasets.
//
// A dataset's identity is the bytes it came from. Hashing at ingest means the
// same layer added twice — or shared by two dashboards — is stored once, and a
// share link is pinned to the exact data version it was published with.

/** SHA-256 of a string or ArrayBuffer, as lowercase hex. */
export async function contentHash(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  // Available on https and localhost; both cases the app actually runs in.
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return fallbackHash(bytes);
}

/**
 * Non-cryptographic fallback (FNV-1a, 64-bit) for insecure origins, where
 * SubtleCrypto is unavailable. Collision risk is irrelevant here — this only
 * ever decides "have I already stored these exact bytes".
 */
function fallbackHash(bytes) {
  let h1 = 0x811c9dc5, h2 = 0xc9dc5118;
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i];
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= bytes[bytes.length - 1 - i];
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return `fnv${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** Short form for display and URLs — full hash stays the storage key. */
export const shortHash = (hash) => (hash ? hash.slice(0, 12) : null);
