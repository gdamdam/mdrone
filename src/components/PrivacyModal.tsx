import { useEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  onClose: () => void;
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 1.6,
  textTransform: "uppercase",
  color: "var(--preview)",
  margin: "14px 0 6px",
};

const list: React.CSSProperties = {
  paddingLeft: 18,
  margin: 0,
};

const link: React.CSSProperties = { color: "var(--preview)" };

export function PrivacyModal({ onClose }: Props) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return createPortal(
    <div className="fx-modal-backdrop" onClick={onClose}>
      <div
        className="fx-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 460, textAlign: "left" }}
      >
        <div className="fx-modal-header">
          <div className="fx-modal-title">Privacy</div>
          <button className="fx-modal-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--text)" }}>
          <p style={{ margin: 0 }}>
            mdrone has no accounts, no cookies, no ads, and no personal tracking.
          </p>

          <div style={sectionLabel}>Does not collect</div>
          <ul style={list}>
            <li>Accounts, emails, user IDs, fingerprints</li>
            <li>Login, ad, or analytics cookies</li>
            <li>Third-party ad trackers</li>
          </ul>

          <div style={sectionLabel}>Does collect</div>
          <ul style={list}>
            <li>
              Anonymous page counts via{" "}
              <a href="https://goatcounter.com" target="_blank" rel="noopener noreferrer" style={link}>GoatCounter</a>
            </li>
          </ul>

          <div style={sectionLabel}>Stays on your device</div>
          <ul style={list}>
            <li>Drones, presets, settings, custom tunings (<code>localStorage</code>)</li>
            <li>Recordings (rendered locally, never uploaded)</li>
            <li>Audio is generated in your browser — no server sound engine</li>
          </ul>

          <p style={{ margin: "14px 0 0", fontSize: 11.5, opacity: 0.75 }}>
            Hosted on{" "}
            <a href="https://pages.github.com" target="_blank" rel="noopener noreferrer" style={link}>GitHub Pages</a>.
            Source at{" "}
            <a href="https://github.com/gdamdam/mdrone" target="_blank" rel="noopener noreferrer" style={link}>github.com/gdamdam/mdrone</a>{" "}
            (AGPL-3.0).
          </p>
          <p style={{ margin: "10px 0 0", fontStyle: "italic", opacity: 0.7, fontSize: 11.5 }}>
            Your drone stays on your device. Always.
          </p>
        </div>
        <div className="fx-modal-actions" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button className="header-btn" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
