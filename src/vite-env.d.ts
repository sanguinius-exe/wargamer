/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** wss:// URL of the signalling / sync relay (Cloudflare Worker). */
  readonly VITE_RELAY_URL?: string;
  /** Shared secret the relay requires (see relay/README.md); optional. */
  readonly VITE_RELAY_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
