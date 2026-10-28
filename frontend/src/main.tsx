import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { enableWebShell } from "@shared/api";
import { useSettingsStore } from "@shared/settings";
import "@shared/ui/styles/bundledFonts.css";
import "./tokens.css";
import "@shared/ui/index.css";
import "./global.css";

// One bundle, two shells: the desktop IDE inside Tauri, the arris server's web UI
// in a browser. Imported lazily so neither shell loads the other's modules.
async function mount(): Promise<void> {
  let root: React.ReactElement;
  if (isTauri()) {
    const { default: App } = await import("@shell/components/App");
    root = <App />;
  } else {
    enableWebShell();
    const { WebApp } = await import("@shell/components/WebApp");
    // Applies the default theme so the [data-theme] color tokens resolve.
    useSettingsStore.getState().hydrate();
    root = <WebApp />;
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>{root}</React.StrictMode>,
  );
}

void mount();
