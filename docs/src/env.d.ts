/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Mixpanel project token. Injected at build/runtime; absent in local dev. */
  readonly PUBLIC_MIXPANEL_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
