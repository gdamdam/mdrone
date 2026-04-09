import type { PortableScene } from "./session";
import { normalizePortableScene } from "./session";

const CODEC_TIMEOUT_MS = 2500;

function bytesToUrlSafeB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function urlSafeB64ToBytes(payload: string): Uint8Array {
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
  if (typeof DecompressionStream === "undefined") return input;
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

export async function buildSceneShareUrl(scene: PortableScene): Promise<string> {
  const { key, value } = await encodeScenePayload(scene);
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?${key}=${value}`;
}

export function extractScenePayloadFromUrl(url: string | URL): { payload: string; compressed: boolean } | null {
  const target = typeof url === "string" ? new URL(url) : url;
  const compressed = (target.searchParams.get("z") || "").replace(/ /g, "+");
  if (compressed) return { payload: compressed, compressed: true };
  const plain = (target.searchParams.get("b") || "").replace(/ /g, "+");
  if (plain) return { payload: plain, compressed: false };
  return null;
}

export async function decodeScenePayload(
  payload: string,
  compressed: boolean,
): Promise<PortableScene | null> {
  try {
    const bytes = urlSafeB64ToBytes(payload);
    const decodedBytes = compressed
      ? await withTimeout(decompressBytes(bytes), CODEC_TIMEOUT_MS)
      : bytes;
    const json = new TextDecoder().decode(decodedBytes);
    return normalizePortableScene(JSON.parse(json));
  } catch {
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
