import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite-Konfiguration.
 *
 * - host: true  → der Entwicklungsserver ist auch aus dem WLAN erreichbar,
 *   sodass die App direkt auf dem Smartphone getestet werden kann.
 * - proxy       → alle Anfragen an /api gehen an das Backend auf Port 4000.
 *   Dadurch braucht das Frontend keine absolute Server-Adresse und es gibt
 *   keine CORS-Probleme.
 *
 * Für eine spätere App-Store-Version (Capacitor) wird der Ordner dist/
 * unverändert in die native Hülle übernommen; dort muss dann in
 * src/api/client.ts eine absolute API-Adresse gesetzt werden (VITE_API_URL).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
