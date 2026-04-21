import { useState } from "react";
import { APP_VERSION } from "../config";
import { PrivacyModal } from "./PrivacyModal";

/**
 * Footer — matches the mloop AppFooter layout: version, copyright,
 * repo link, help / support / license / cross-link / privacy line.
 * Two rows, centered, dimmed text, ember accent on the ko-fi link.
 */
export function Footer() {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  return (
    <footer className="app-footer" style={{
      textAlign: "center",
      padding: "16px 12px 24px",
      fontSize: 12,
      color: "var(--text-dim)",
      opacity: 0.7,
      lineHeight: 1.8,
    }}>
      <span>v{APP_VERSION}</span>
      {" · "}
      <span>© 2026</span>
      {" · "}
      <a
        href="https://github.com/gdamdam/mdrone"
        target="_blank"
        rel="noopener"
        style={{ color: "var(--text-dim)", textDecoration: "none" }}
      >
        github.com/gdamdam/mdrone
      </a>
      <div style={{ marginTop: 4 }}>
        <a
          href="https://ko-fi.com/gdamdam"
          target="_blank"
          rel="noopener"
          style={{ color: "#ff4466", fontWeight: 700, textDecoration: "none" }}
        >
          Support ♥
        </a>
        {" · "}
        <a
          href="https://github.com/gdamdam/mdrone/blob/main/LICENSE"
          target="_blank"
          rel="noopener"
          style={{ color: "var(--text-dim)", textDecoration: "none" }}
        >
          AGPL-3.0
        </a>
        {" · "}
        <button
          type="button"
          onClick={() => setPrivacyOpen(true)}
          title="Privacy"
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            margin: 0,
            font: "inherit",
            color: "var(--text-dim)",
            textDecoration: "underline dotted",
            cursor: "pointer",
          }}
        >
          No cookies · No personal data
        </button>
      </div>
      {privacyOpen && <PrivacyModal onClose={() => setPrivacyOpen(false)} />}
    </footer>
  );
}
