import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PortableScene } from "../session";
import { shortenSceneUrl, trackShare } from "../shareRelay";
import { trackEvent } from "../analytics";

interface ShareModalProps {
  initialName: string;
  onBuildShareData: (name: string) => Promise<{ scene: PortableScene; url: string }>;
  onClose: () => void;
}

/**
 * Scene link modal — utility, not a content tool.
 *
 * Generates a self-contained URL that encodes the full scene state.
 * The recipient pastes the URL anywhere, opens it, and lands in the
 * exact same drone landscape. No visual cards, no social-share
 * artifact — link sharing exists because URL-as-bookmark is genuinely
 * useful (re-opening a scene you liked, sending it to yourself across
 * devices), not because mdrone is a content-creation tool.
 */
export function ShareModal({ initialName, onBuildShareData, onClose }: ShareModalProps) {
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState("");
  const [shortInfo, setShortInfo] = useState<{ short: string; id: string } | null>(null);
  const [showLongUrl, setShowLongUrl] = useState(false);
  const shortCacheRef = useRef<Map<string, { short: string; id: string }>>(new Map());
  const [busy, setBusy] = useState(true);
  const [shortBusy, setShortBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const canNativeShare = useMemo(
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const next = await onBuildShareData(name.trim() || initialName);
        if (!cancelled) {
          trackEvent("share/created");
          setUrl(next.url);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Could not build share link.";
          setError(message);
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
  }, [initialName, name, onBuildShareData]);

  useEffect(() => {
    if (!url) {
      setShortInfo(null);
      setShortBusy(false);
      return;
    }
    const cached = shortCacheRef.current.get(url);
    if (cached) {
      setShortInfo(cached);
      setShortBusy(false);
      return;
    }
    setShortInfo(null);
    setShortBusy(true);
    let cancelled = false;
    void shortenSceneUrl(url).then((result) => {
      if (cancelled) return;
      setShortBusy(false);
      if (!result) return;
      const entry = { short: result.short, id: result.id };
      shortCacheRef.current.set(url, entry);
      setShortInfo(entry);
    });
    return () => { cancelled = true; };
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

  const nativeShare = async () => {
    if (!displayUrl || typeof navigator.share !== "function") return;
    try {
      await navigator.share({
        title: name.trim() || initialName,
        text: "Open this mdrone scene in the browser.",
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
          <div className="fx-modal-title" id={titleId}>Scene Link</div>
          <button ref={closeRef} className="fx-modal-close" onClick={onClose} title="Close (Esc)" aria-label="Close">
            ×
          </button>
        </div>

        <p className="fx-modal-desc">
          Self-contained URL — the recipient opens it, presses Start, and
          lands in this same scene. Useful as a personal bookmark too.
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
                  {busy ? "building..." : shortBusy ? "shortening..." : copied ? "copied" : ""}
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
          <button className="header-btn" onClick={copyLink} disabled={busy || shortBusy || !url}>
            {copied ? "COPIED" : "COPY LINK"}
          </button>
          {canNativeShare && (
            <button className="header-btn" onClick={nativeShare} disabled={busy || shortBusy || !url}>
              SHARE…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
