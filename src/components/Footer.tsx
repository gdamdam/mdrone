import { APP_VERSION } from "../config";

/**
 * Footer — matches the mloop AppFooter layout: version, copyright,
 * repo link, help / support / license / cross-link / privacy line.
 * Two rows, centered, dimmed text, ember accent on the ko-fi link.
 */
export function Footer() {
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
        <a
          href="https://mpump.live/app.html"
          target="_blank"
          rel="noopener"
          style={{ color: "var(--preview)", textDecoration: "none", fontWeight: 700 }}
        >
          Try mpump →
        </a>
        {" · "}
        <a
          href="https://mloop.mpump.live"
          target="_blank"
          rel="noopener"
          style={{ color: "var(--preview)", textDecoration: "none", fontWeight: 700 }}
        >
          Try mloop →
        </a>
        {" · "}
        <span style={{ textDecoration: "underline dotted" }} title="mdrone runs entirely in your browser. No cookies, no tracking, no account.">
          No cookies · No personal data
        </span>
      </div>
    </footer>
  );
}
