/**
 * Zentrale Konfiguration des Servers.
 *
 * Alle Werte lassen sich über Umgebungsvariablen überschreiben (siehe .env.example).
 * Für den lokalen Test-Betrieb sind sinnvolle Standardwerte hinterlegt.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Wurzelverzeichnis des Server-Pakets (…/server) */
export const ROOT_DIR = path.resolve(__dirname, '..');

export const config = {
  /** Port der REST-API */
  port: Number(process.env.PORT || 4000),

  /**
   * Secret für die Signatur der JWT-Zugriffstokens.
   * WICHTIG: Für einen echten Produktivbetrieb zwingend über die Umgebungs-
   * variable JWT_SECRET einen langen Zufallswert setzen.
   */
  jwtSecret: process.env.JWT_SECRET || 'be-service-dev-secret-bitte-in-produktion-aendern',

  /** Gültigkeitsdauer des Logins. 12h = ein Arbeitstag ohne erneutes Anmelden. */
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',

  /** Speicherort der SQLite-Datenbank */
  databaseFile: process.env.DATABASE_FILE || path.join(ROOT_DIR, 'data', 'be-service.db'),

  /** Ablageverzeichnis für hochgeladene PDFs und Bilder */
  uploadDir: process.env.UPLOAD_DIR || path.join(ROOT_DIR, 'uploads'),

  /** Maximale Dateigröße pro Upload (Standard: 20 MB – reicht für Handyfotos) */
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024),

  /**
   * Erlaubte Herkunft für Browser-Anfragen (CORS).
   * Kommagetrennte Liste; '*' erlaubt alles (nur für lokale Tests sinnvoll).
   */
  corsOrigin: process.env.CORS_ORIGIN || '*',

  /**
   * Basis-URL des Frontends – wird für den Link in der
   * "Passwort vergessen"-E-Mail benötigt.
   */
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5173',

  /** Gültigkeit eines Passwort-Reset-Links in Minuten */
  passwordResetTtlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES || 60),

  /** true = Produktionsmodus (strengere Prüfungen, keine Debug-Ausgaben) */
  isProduction: process.env.NODE_ENV === 'production',
};

// Sicherheitsnetz: In Produktion darf das Standard-Secret nicht verwendet werden.
if (config.isProduction && !process.env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET muss im Produktionsbetrieb gesetzt sein (siehe server/.env.example).'
  );
}
