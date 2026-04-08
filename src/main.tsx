import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { App } from "./App";
import { PALETTES, applyPalette, loadPaletteId } from "./themes";

const palette = PALETTES.find((item) => item.id === loadPaletteId());
if (palette) applyPalette(palette);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
