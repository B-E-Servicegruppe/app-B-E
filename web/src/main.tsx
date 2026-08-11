/**
 * Einstiegspunkt des Frontends.
 *
 * Aufbau des Projekts:
 *   src/api/         – Zugriff auf die REST-API und Datentypen
 *   src/auth/        – Anmeldezustand (Kontext)
 *   src/components/  – wiederverwendbare Bausteine (Layout, Icons, Dialoge)
 *   src/pages/       – die einzelnen Bildschirme
 *   src/utils/       – Helfer für Datum und Beschriftungen
 *   src/styles/      – Farben und Grundgestaltung
 */
// theme.css bewusst als ERSTER Import: So stehen die Grundregeln im gebündelten
// Stylesheet vor den Seiten-Stilen, und spätere Anpassungen (z. B. .status-btn)
// überschreiben die Grundregeln zuverlässig.
import './styles/theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
