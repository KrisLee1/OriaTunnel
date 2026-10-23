import React from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import "./lib/keyboard-focus";
import "./styles/globals.css";
import "./styles/tunnel.css";
import "@xyflow/react/dist/style.css";
import { bootstrapAideTheme } from "./components/theme/theme-bootstrap";
import { OriaAideThemeProvider } from "./components/theme/aide-theme-provider";
import { App } from "./App";
bootstrapAideTheme();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OriaAideThemeProvider>
      <App />
    </OriaAideThemeProvider>
  </React.StrictMode>,
);
