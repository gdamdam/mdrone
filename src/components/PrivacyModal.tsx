import { useEffect } from "react";

interface Props {
  onClose: () => void;
}

export function PrivacyModal({ onClose }: Props) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return (
    <div className="fx-modal-backdrop" onClick={onClose}>
      <div className="fx-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="fx-modal-header">
          <div className="fx-modal-title">Privacy</div>
          <button className="fx-modal-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text)", maxHeight: "70dvh", overflowY: "auto", padding: "0 16px 16px" }}>
          <p style={{ marginBottom: 12 }}>mdrone does not use accounts, cookies, ads, or personal tracking.</p>
          <p style={{ marginBottom: 12 }}>A small amount of anonymous operational data does exist, because the app still needs basic traffic counters to stay alive and improve.</p>
          <p style={{ marginTop: 14, marginBottom: 6, fontWeight: 700, fontSize: 13 }}>What mdrone does not collect</p>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li><strong>No accounts</strong>: no sign-up, no email, no user profile</li>
            <li><strong>No cookies</strong>: mdrone does not set login, ad, or analytics cookies</li>
            <li><strong>No user IDs</strong>: mdrone does not assign you a persistent personal identifier</li>
            <li><strong>No fingerprinting</strong>: mdrone does not try to build a hidden identity from your device or browser</li>
            <li><strong>No third-party ad trackers</strong>: no Google Ads, Meta Pixel, or similar ad-tech</li>
          </ul>
          <p style={{ marginTop: 14, marginBottom: 6, fontWeight: 700, fontSize: 13 }}>What mdrone does collect</p>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li><strong>Anonymous page counts</strong>: plain traffic counts via <a href="https://goatcounter.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--preview)" }}>GoatCounter</a></li>
          </ul>
          <p style={{ marginTop: 14, marginBottom: 6, fontWeight: 700, fontSize: 13 }}>What stays local</p>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li><strong>Your drones, presets, and settings</strong>: stored in your browser on your device</li>
            <li><strong>Your recordings</strong>: rendered locally in the browser and downloaded to your device — never uploaded</li>
            <li><strong>Your custom tunings</strong>: saved in <code style={{ fontSize: 12 }}>localStorage</code> on your device</li>
            <li><strong>Your audio</strong>: generated locally in the browser; mdrone has no server-side sound engine</li>
            <li><strong>Open source</strong>: full source code at <a href="https://github.com/gdamdam/mdrone" target="_blank" rel="noopener noreferrer" style={{ color: "var(--preview)" }}>github.com/gdamdam/mdrone</a> under AGPL-3.0</li>
          </ul>
          <p style={{ marginTop: 14, marginBottom: 6, fontWeight: 700, fontSize: 13 }}>AI crawlers</p>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li>Known AI training bots (GPTBot, Google-Extended, ClaudeBot, anthropic-ai, PerplexityBot, CCBot, Bytespider, Amazonbot, Applebot-Extended, cohere-ai, Meta-ExternalAgent) are blocked in <code style={{ fontSize: 12 }}>robots.txt</code>. Regular search engines are allowed.</li>
          </ul>
          <p style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6 }}>mdrone is hosted on <a href="https://pages.github.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--preview)" }}>GitHub Pages</a>.</p>
          <p style={{ marginTop: 8, fontSize: 12 }}>Short version: mdrone tries to know as little about you as possible while still being usable and maintainable.</p>
          <p style={{ marginTop: 12, opacity: 0.7, fontSize: 12 }}>Your drone stays on your device. Always.</p>
        </div>
        <div className="fx-modal-actions" style={{ padding: "0 16px 16px", justifyContent: "flex-end" }}>
          <button className="header-btn" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}
