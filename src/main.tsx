import React from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "./i18n";
import "./lib/keyboard-focus";
import { installWebviewGuards } from "./lib/webview-guards";
import "./styles/globals.css";
import "./styles/tunnel.css";
import "@xyflow/react/dist/style.css";
import { bootstrapAideTheme } from "./components/theme/theme-bootstrap";
import { OriaAideThemeProvider } from "./components/theme/aide-theme-provider";
import { App } from "./App";
import { ApplicationIconSync } from "./components/settings/application-icon-sync";
bootstrapAideTheme();
installWebviewGuards(document, import.meta.env.PROD);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OriaAideThemeProvider>
      <MotionConfig reducedMotion="user">
        <ApplicationIconSync />
        <App />
      </MotionConfig>
    </OriaAideThemeProvider>
  </React.StrictMode>,
);
