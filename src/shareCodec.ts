import type { PortableScene } from "./session";
import { normalizePortableScene } from "./session";

const CODEC_TIMEOUT_MS = 2500;

// Exported (with urlSafeB64ToBytes) so unit tests can verify byte-level
// encode/decode behavior without going through scene JSON.
export function bytesToUrlSafeB64(bytes: Uint8Array): string {
  // Convert in chunks instead of per-byte string concat (quadratic-ish as
  // motion payloads grow). Chunked because a single fromCharCode.apply over
  // the whole payload can exceed the engine's argument-list limit and throw.
  const CHUNK_SIZE = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    parts.push(String.fromCharCode.apply(null, chunk as unknown as number[]));
  }
  return btoa(parts.join("")).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function urlSafeB64ToBytes(payload: string): Uint8Array {
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Use Blob.stream().pipeThrough(...) so the reader and writer run
// concurrently. The previous `write(); close(); read()` pattern could
// deadlock on backpressure in WebKit, which is why the share modal was
// always falling back to the plain `?b=` encoding.
async function compressBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return input;
  const piped = new Blob([new Uint8Array(input)])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  const result = await new Response(piped).arrayBuffer();
  return new Uint8Array(result);
}

async function decompressBytes(input: Uint8Array): Promise<Uint8Array> {
  // No silent fallback here: returning the raw deflate bytes would make
  // JSON.parse fail downstream and look like a corrupt link. Callers must
  // check for DecompressionStream support before invoking.
  const piped = new Blob([new Uint8Array(input)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const result = await new Response(piped).arrayBuffer();
  return new Uint8Array(result);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("Share codec timed out."));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

export async function encodeScenePayload(scene: PortableScene): Promise<{ key: "z" | "b"; value: string }> {
  const json = JSON.stringify(scene);
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream !== "undefined") {
    try {
      const compressed = await withTimeout(compressBytes(bytes), CODEC_TIMEOUT_MS);
      return { key: "z", value: bytesToUrlSafeB64(compressed) };
    } catch {
      // Safari/WebKit can expose CompressionStream but stall indefinitely.
      // Plain base64 is larger, but a reliable link is better than a hung UI.
    }
  }
  return { key: "b", value: bytesToUrlSafeB64(bytes) };
}

/** The share-card worker origin. Shared links route through it so
 *  social-platform unfurl bots see OG meta + card art. The worker
 *  then meta-redirects humans to the app origin. */
const SHARE_WORKER_ORIGIN = "https://s.mdrone.org";

export async function buildSceneShareUrl(scene: PortableScene): Promise<string> {
  const { key, value } = await encodeScenePayload(scene);
  return `${SHARE_WORKER_ORIGIN}/?${key}=${value}`;
}

export function extractScenePayloadFromUrl(url: string | URL): { payload: string; compressed: boolean } | null {
  let target: URL;
  try {
    // Exported API: a malformed string must yield null, not a TypeError.
    target = typeof url === "string" ? new URL(url) : url;
  } catch {
    return null;
  }
  const compressed = (target.searchParams.get("z") || "").replace(/ /g, "+");
  if (compressed) return { payload: compressed, compressed: true };
  const plain = (target.searchParams.get("b") || "").replace(/ /g, "+");
  if (plain) return { payload: plain, compressed: false };
  return null;
}

/** Why decoding returned null, so callers can message the user instead of
 *  treating an unsupported browser the same as a corrupt link. */
export type SceneDecodeFailureReason = "unsupported-compression" | "invalid-payload";

export async function decodeScenePayload(
  payload: string,
  compressed: boolean,
  failure?: { reason?: SceneDecodeFailureReason },
): Promise<PortableScene | null> {
  if (compressed && typeof DecompressionStream === "undefined") {
    // Old browsers without DecompressionStream can't open `?z=` links.
    // Fail explicitly rather than parsing raw deflate bytes as JSON.
    if (failure) failure.reason = "unsupported-compression";
    return null;
  }
  try {
    const bytes = urlSafeB64ToBytes(payload);
    const decodedBytes = compressed
      ? await withTimeout(decompressBytes(bytes), CODEC_TIMEOUT_MS)
      : bytes;
    const json = new TextDecoder().decode(decodedBytes);
    return normalizePortableScene(JSON.parse(json));
  } catch {
    if (failure) failure.reason = "invalid-payload";
    return null;
  }
}

export async function loadSceneFromCurrentUrl(): Promise<PortableScene | null> {
  const extracted = extractScenePayloadFromUrl(window.location.href);
  if (!extracted) return null;
  return decodeScenePayload(extracted.payload, extracted.compressed);
}

/**
 * Cached one-shot load so App.tsx (splash gate) and Layout.tsx (scene
 * application) both see the same decoded scene without decoding twice.
 * Keyed by href so reloads or client-side URL changes get a fresh decode.
 */
let cachedSceneLoad: { href: string; promise: Promise<PortableScene | null> } | null = null;
export function loadSceneFromCurrentUrlOnce(): Promise<PortableScene | null> {
  const href = window.location.href;
  if (!cachedSceneLoad || cachedSceneLoad.href !== href) {
    cachedSceneLoad = { href, promise: loadSceneFromCurrentUrl() };
  }
  return cachedSceneLoad.promise;
}
