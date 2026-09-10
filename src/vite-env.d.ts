/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** wss:// URL of the signalling / sync relay (Cloudflare Worker). */
  readonly VITE_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
