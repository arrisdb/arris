import React from "react";
import ReactDOM from "react-dom/client";
import App from "@shell/components/App";
import "@shared/ui/styles/bundledFonts.css";
import "./tokens.css";
import "@shared/ui/index.css";
import "./global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
