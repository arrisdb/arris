/// <reference types="vitest" />
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const srcAlias = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

// https://vite.dev/config
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@domains": srcAlias("domains"),
      "@shell": srcAlias("shell"),
      "@shared": srcAlias("shared"),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: false,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
