import { useEffect, useMemo, useRef, useState } from "react";
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
  const [scene, setScene] = useState<PortableScene | null>(null);
  const [styleChoice, setStyleChoice] = useState<SceneCardStyleChoice>("auto");
  const [busy, setBusy] = useState(true);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canNativeShare = useMemo(
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    [],
  );
  const resolvedStyle = scene ? resolveSceneCardStyle(styleChoice, scene) : "fractal";

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const next = await onBuildShareData(name.trim() || initialName, resolvedStyle);
        if (!cancelled) {
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
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
    if (!url || typeof navigator.share !== "function") return;
    try {
      await navigator.share({
        title: name.trim() || initialName,
        text: "Open this mdrone landscape in the browser.",
        url,
      });
    } catch {
      // ignore cancelled shares
    }
  };

  return (
    <div className="fx-modal-backdrop" onClick={onClose}>
      <div className="fx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fx-modal-header">
          <div className="fx-modal-title">Share Scene</div>
          <button className="fx-modal-close" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>

        <p className="fx-modal-desc">
          Share the full drone landscape as a self-contained link. The recipient opens it,
          presses Start, and lands in the same scene.
        </p>

        <div className="share-card-preview">
          <canvas
            ref={canvasRef}
            className="share-card-canvas"
            aria-label={`Scene card preview in ${SCENE_CARD_STYLE_LABELS[resolvedStyle]} style`}
          />
          <div className="share-card-meta">
            <span className="share-card-meta-chip">CARD</span>
            <span className="share-card-meta-value">{SCENE_CARD_STYLE_LABELS[resolvedStyle]}</span>
            <span className="share-card-meta-sep">·</span>
            <span className="share-card-meta-value">{scene ? scene.ui.visualizer.toUpperCase() : "BUILDING"}</span>
          </div>
        </div>

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

          <div className="fx-modal-param">
            <span className="fx-modal-param-label">CARD STYLE</span>
            <div className="share-style-row" role="radiogroup" aria-label="Card style">
              {(["auto", "sigil", "tarot", "fractal"] as SceneCardStyleChoice[]).map((style) => (
                <button
                  type="button"
                  key={style}
                  role="radio"
                  aria-checked={styleChoice === style}
                  className={
                    styleChoice === style
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

          <label className="fx-modal-param">
            <span className="fx-modal-param-label">
              LINK
              <span className="fx-modal-param-value">{busy ? "building..." : copied ? "copied" : ""}</span>
            </span>
            <textarea
              className="share-modal-url"
              readOnly
              value={error ? error : url}
              rows={4}
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
