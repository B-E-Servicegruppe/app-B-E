/// <reference types="vite/client" />

/**
 * Typen für die Umgebungsvariablen des Frontends.
 * VITE_API_URL wird nur für die spätere App-Store-Version benötigt
 * (dort gibt es keinen Entwicklungs-Proxy).
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
