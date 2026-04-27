import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Friendly label shown in the fallback UI ("the app", "MEDITATE", etc.) */
  scope?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render / lifecycle exceptions in the subtree and shows a
 * fallback UI instead of unmounting the whole React root to a blank
 * screen. The audio engine is a module-scope singleton (see App.tsx),
 * so it survives a Layout unmount — the fallback's "try again" button
 * remounts the subtree without nuking sound.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No remote error reporting — keep it console-only to honour the
    // privacy stance documented in README. A user-pasted console log
    // is the bug report channel.
    console.error("[mdrone] ErrorBoundary caught", error, info);
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const scope = this.props.scope ?? "the app";
    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          textAlign: "center",
          gap: "1rem",
          background: "var(--bg, #1a1614)",
          color: "var(--text, #e8d8b8)",
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        <h1 style={{ fontSize: "1.2rem", margin: 0, letterSpacing: "0.05em" }}>
          Something went wrong in {scope}.
        </h1>
        <p style={{ maxWidth: "32rem", opacity: 0.75, fontSize: "0.9rem", lineHeight: 1.5 }}>
          The drone is safe — audio keeps running in the background. You can
          try restoring this view, or reload the page to start fresh.
        </p>
        <pre
          style={{
            maxWidth: "32rem",
            padding: "0.75rem 1rem",
            background: "var(--bg-elevated, #221d1a)",
            border: "1px solid var(--border, #3a302a)",
            borderRadius: "4px",
            fontSize: "0.75rem",
            opacity: 0.6,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            textAlign: "left",
          }}
        >
          {this.state.error.message || String(this.state.error)}
        </pre>
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              padding: "0.5rem 1.25rem",
              background: "transparent",
              color: "var(--text, #e8d8b8)",
              border: "1px solid var(--border, #3a302a)",
              borderRadius: "4px",
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.05em",
            }}
          >
            TRY AGAIN
          </button>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: "0.5rem 1.25rem",
              background: "var(--accent, #c89060)",
              color: "var(--bg, #1a1614)",
              border: "1px solid var(--accent, #c89060)",
              borderRadius: "4px",
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.05em",
            }}
          >
            RELOAD
          </button>
        </div>
      </div>
    );
  }
}
