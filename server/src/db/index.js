/**
 * Datenbankzugriff (SQLite via better-sqlite3).
 *
 * better-sqlite3 arbeitet synchron. Das ist für eine Team-App dieser Größe
 * ideal: kein Callback-/Promise-Overhead, transaktionssicher und schnell.
 *
 * Sollte die App später auf PostgreSQL umziehen, muss nur dieses Modul und die
 * SQL-Syntax in den Routen angepasst werden – die Tabellenstruktur ist bereits
 * portabel gehalten.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Verzeichnisse anlegen, falls sie noch nicht existieren
fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

/** Geteilte Datenbankverbindung für den gesamten Serverprozess. */
export const db = new Database(config.databaseFile);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Wendet das Schema an. Alle Anweisungen sind mit "IF NOT EXISTS" formuliert,
 * der Aufruf ist daher bei jedem Serverstart unbedenklich.
 */
export function applySchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

/**
 * Hilfsfunktion: aktueller Zeitstempel im Format der Datenbank (ISO-8601, UTC).
 * @returns {string}
 */
export function now() {
  return new Date().toISOString();
}

/**
 * Führt eine Funktion in einer Transaktion aus (alles oder nichts).
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function transaction(fn) {
  return db.transaction(fn)();
}
