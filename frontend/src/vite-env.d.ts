/// <reference types="vite/client" />

declare module "*?raw" {
  const content: string;
  export default content;
}

declare module "tauri-pty/dist/index.es.js" {
  export { spawn } from "tauri-pty";
}
