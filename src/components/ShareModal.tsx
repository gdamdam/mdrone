import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PortableScene } from "../session";
import {
  SCENE_CARD_STYLE_LABELS,
  type SceneCardStyle,
  type SceneCardStyleChoice,
  renderSceneCardPng,
  renderSceneCardToCanvas,
  resolveSceneCardStyle,
  withSceneCardStyleParam,
} from "../shareCard";
import { shortenSceneUrl, trackShare } from "../shareRelay";
import { trackEvent } from "../analytics";

interface ShareModalProps {
  initialName: string;
  onBuildShareData: (name: string, style: SceneCardStyle) => Promise<{ scene: PortableScene; url: string }>;
  onClose: () => void;
}

function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function sanitizeFilename(input: string): string {
  const clean = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "mdrone-scene-card";
}

export function ShareModal({ initialName, onBuildShareData, onClose }: ShareModalProps) {
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState("");
  const [shortInfo, setShortInfo] = useState<{ short: string; id: string } | null>(null);
  const [showLongUrl, setShowLongUrl] = useState(false);
  const shortCacheRef = useRef<Map<string, { short: string; id: string }>>(new Map());
  const [scene, setScene] = useState<PortableScene | null>(null);
  const [styleChoice, setStyleChoice] = useState<SceneCardStyleChoice>("auto");
  const [busy, setBusy] = useState(true);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const canNativeShare = useMemo(
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    [],
  );
  const resolvedStyle = scene ? resolveSceneCardStyle(styleChoice, scene) : "tessera";

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const next = await onBuildShareData(name.trim() || initialName, resolvedStyle);
        if (!cancelled) {
          trackEvent("share/created");
          setScene(next.scene);
          setBaseUrl(next.url);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Could not build share link.";
          setError(message);
          setScene(null);
          setBaseUrl("");
          setUrl("");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [initialName, name, onBuildShareData, resolvedStyle]);

  useEffect(() => {
    if (!baseUrl || !scene) {
      if (!error) setUrl("");
      return;
    }
    setUrl(withSceneCardStyleParam(baseUrl, resolvedStyle));
  }, [baseUrl, error, resolvedStyle, scene]);

  useEffect(() => {
    if (!url) {
      setShortInfo(null);
      return;
    }
    const cached = shortCacheRef.current.get(url);
    if (cached) {
      setShortInfo(cached);
      return;
    }
    setShortInfo(null);
    let cancelled = false;
    void shortenSceneUrl(url).then((result) => {
      if (cancelled || !result) return;
      const entry = { short: result.short, id: result.id };
      shortCacheRef.current.set(url, entry);
      setShortInfo(entry);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const shortUrl = shortInfo?.short ?? null;
  const isShortened = shortUrl !== null && shortUrl !== url;
  const displayUrl = showLongUrl || !shortUrl ? url : shortUrl;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener && typeof opener.focus === "function") {
        try { opener.focus(); } catch { /* ok */ }
      }
    };
  }, [onClose]);

  useEffect(() => {
    if (!scene || !canvasRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        if (canvasRef.current && !cancelled) {
          await renderSceneCardToCanvas(canvasRef.current, scene, resolvedStyle);
        }
      } catch (err) {
        console.error("mdrone: scene card render failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolvedStyle, scene]);

  const copyLink = async () => {
    if (!displayUrl) return;
    const legacyCopy = (): boolean => {
      try {
        const ta = document.createElement("textarea");
        ta.value = displayUrl;
        ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    };
    let ok = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(displayUrl);
        ok = true;
      } catch {
        ok = legacyCopy();
      }
    } else {
      ok = legacyCopy();
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      if (shortInfo?.id) trackShare(shortInfo.id);
    } else {
      setError("Clipboard copy failed. You can still select the link manually.");
    }
  };

  const downloadCard = async () => {
    if (!scene || !canvasRef.current) return;
    setDownloadBusy(true);
    try {
      try {
        const bytes = await renderSceneCardPng(scene, resolvedStyle);
        const safeBytes = new Uint8Array(bytes.byteLength);
        safeBytes.set(bytes);
        downloadBlob(new Blob([safeBytes], { type: "image/png" }), `${sanitizeFilename(name)}-${resolvedStyle}.png`);
      } catch {
        const fallback = await new Promise<Blob>((resolve, reject) => {
          canvasRef.current?.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Canvas export failed."));
          }, "image/png");
        });
        downloadBlob(fallback, `${sanitizeFilename(name)}-${resolvedStyle}.png`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not export scene card.";
      setError(message);
    } finally {
      setDownloadBusy(false);
    }
  };

  const nativeShare = async () => {
    if (!displayUrl || typeof navigator.share !== "function") return;
    try {
      await navigator.share({
        title: name.trim() || initialName,
        text: "Open this mdrone landscape in the browser.",
        url: displayUrl,
      });
      if (shortInfo?.id) trackShare(shortInfo.id);
    } catch {
      // ignore cancelled shares
    }
  };

  return (
    <div className="fx-modal-backdrop" onClick={onClose}>
      <div
        className="fx-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fx-modal-header">
          <div className="fx-modal-title" id={titleId}>Share Scene</div>
          <button ref={closeRef} className="fx-modal-close" onClick={onClose} title="Close (Esc)" aria-label="Close">
            ×
          </button>
        </div>

        <p className="fx-modal-desc">
          Share the full drone landscape as a self-contained link. The recipient opens it,
          presses Start, and lands in the same scene.
        </p>

        <div className="fx-modal-params">
          <label className="fx-modal-param">
            <span className="fx-modal-param-label">SCENE NAME</span>
            <input
              className="share-modal-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Drone Landscape"
              maxLength={80}
            />
          </label>
        </div>

        <div className="share-card-preview">
          <canvas
            ref={canvasRef}
            className="share-card-canvas"
            aria-label={`Scene card preview in ${SCENE_CARD_STYLE_LABELS[resolvedStyle]} style`}
          />
          <div className="share-style-row" role="radiogroup" aria-label="Card style">
            {(["sigil", "tarot", "tessera", "talisman"] as const).map((style) => (
              <button
                type="button"
                key={style}
                role="radio"
                aria-checked={resolvedStyle === style}
                className={
                  resolvedStyle === style
                    ? "share-style-btn share-style-btn-active"
                    : "share-style-btn"
                }
                onClick={() => setStyleChoice(style)}
              >
                {SCENE_CARD_STYLE_LABELS[style]}
              </button>
            ))}
          </div>
        </div>

        <div className="fx-modal-params">

          <label className="fx-modal-param">
            <span className="fx-modal-param-label share-modal-link-label">
              <span>LINK</span>
              <span className="share-modal-link-meta">
                {isShortened && !error && (
                  <button
                    type="button"
                    className="share-modal-url-toggle"
                    onClick={() => setShowLongUrl((v) => !v)}
                    title={
                      showLongUrl
                        ? "Switch to short link (requires relay)"
                        : "Switch to full link (self-contained, works even if the relay is offline)"
                    }
                  >
                    {showLongUrl ? "short link" : "full link (offline)"}
                  </button>
                )}
                <span className="fx-modal-param-value">
                  {busy ? "building..." : copied ? "copied" : ""}
                </span>
              </span>
            </span>
            <input
              className="share-modal-url"
              readOnly
              value={error ? error : displayUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
        </div>

        <div className="fx-modal-actions">
          <button className="header-btn header-btn-share" onClick={copyLink} disabled={busy || !url}>
            {copied ? "COPIED" : "COPY LINK"}
          </button>
          <button className="header-btn" onClick={downloadCard} disabled={busy || !scene || downloadBusy}>
            {downloadBusy ? "EXPORTING…" : "DOWNLOAD CARD"}
          </button>
          {canNativeShare && (
            <button className="header-btn" onClick={nativeShare} disabled={busy || !url}>
              SHARE…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
