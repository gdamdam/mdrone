/**
 * Footer — minimal credits line. Matches mpump/mloop family style:
 * built by, companions, license.
 */
export function Footer() {
  return (
    <footer className="app-footer">
      <span>
        built by{" "}
        <a href="https://github.com/gdamdam" target="_blank" rel="noreferrer">
          gdamdam
        </a>
      </span>
      <span className="footer-sep">·</span>
      <span>
        companion to{" "}
        <a href="https://mpump.live" target="_blank" rel="noreferrer">
          mpump
        </a>{" "}
        +{" "}
        <a href="https://mloop.mpump.live" target="_blank" rel="noreferrer">
          mloop
        </a>
      </span>
      <span className="footer-sep">·</span>
      <span>AGPL-3.0</span>
    </footer>
  );
}
