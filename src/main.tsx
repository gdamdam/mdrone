import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import "./styles/tutorial.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PALETTES, applyPalette, loadPaletteId } from "./themes";
import { registerServiceWorker } from "./swRegister";

const palette = PALETTES.find((item) => item.id === loadPaletteId());
if (palette) applyPalette(palette);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary scope="mdrone">
      <App />
    </ErrorBoundary>
  </StrictMode>
);

registerServiceWorker();
