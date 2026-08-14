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
  migrateAddColumns();
}

/**
 * Ergänzt Spalten, die nach dem ersten Anlegen der Tabelle hinzugekommen sind.
 * "CREATE TABLE IF NOT EXISTS" (siehe schema.sql) erstellt eine neue Spalte
 * NICHT nachträglich in einer bereits bestehenden Datenbank – dafür ist dieser
 * Schritt da. Jede Ergänzung prüft zuerst, ob die Spalte schon existiert, der
 * Aufruf ist daher bei jedem Serverstart unbedenklich.
 */
function migrateAddColumns() {
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userColumns.includes('private_email')) {
    db.exec('ALTER TABLE users ADD COLUMN private_email TEXT');
  }

  const orderColumns = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!orderColumns.includes('customer_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL');
  }
  if (!orderColumns.includes('series_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN series_id INTEGER REFERENCES order_series(id) ON DELETE SET NULL');
  }
  if (!orderColumns.includes('subtype')) {
    db.exec('ALTER TABLE orders ADD COLUMN subtype TEXT');
  }

  // order_series: weekday (einzelner Wochentag) -> weekdays (Liste, "0,3").
  // Bestehende Werte werden 1:1 in die neue Spalte übernommen, damit keine
  // bereits angelegten Serien ihre Wochentags-Angabe verlieren.
  const seriesColumns = db.prepare('PRAGMA table_info(order_series)').all().map((c) => c.name);
  if (!seriesColumns.includes('weekdays')) {
    db.exec('ALTER TABLE order_series ADD COLUMN weekdays TEXT');
    if (seriesColumns.includes('weekday')) {
      db.exec("UPDATE order_series SET weekdays = CAST(weekday AS TEXT) WHERE weekday IS NOT NULL");
    }
  }
  if (!seriesColumns.includes('subtype')) {
    db.exec('ALTER TABLE order_series ADD COLUMN subtype TEXT');
  }
  if (!seriesColumns.includes('open_ended')) {
    db.exec('ALTER TABLE order_series ADD COLUMN open_ended INTEGER NOT NULL DEFAULT 0');
  }
  if (!seriesColumns.includes('assignee_ids')) {
    db.exec('ALTER TABLE order_series ADD COLUMN assignee_ids TEXT');
  }

  // Indizes auf die ggf. gerade ergänzten Spalten – bewusst hier und nicht in
  // schema.sql: Dort würden sie auf bestehenden Datenbanken ausgeführt, BEVOR
  // die ALTER-TABLE-Schritte oben die Spalten anlegen, und mit
  // "no such column" fehlschlagen. IF NOT EXISTS macht den Aufruf idempotent.
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_series ON orders(series_id)');

  // shifts: kind/leave_request_id kamen mit der Urlaubsverwaltung hinzu.
  const shiftColumns = db.prepare('PRAGMA table_info(shifts)').all().map((c) => c.name);
  if (!shiftColumns.includes('kind')) {
    db.exec("ALTER TABLE shifts ADD COLUMN kind TEXT NOT NULL DEFAULT 'WORK'");
  }
  if (!shiftColumns.includes('leave_request_id')) {
    db.exec('ALTER TABLE shifts ADD COLUMN leave_request_id INTEGER REFERENCES leave_requests(id) ON DELETE CASCADE');
  }

  // leave_allowances: manual_used_days kam nachträglich hinzu (Urlaub, der
  // vor/außerhalb der App genommen wurde und manuell erfasst werden soll).
  const allowanceColumns = db.prepare('PRAGMA table_info(leave_allowances)').all().map((c) => c.name);
  if (!allowanceColumns.includes('manual_used_days')) {
    db.exec('ALTER TABLE leave_allowances ADD COLUMN manual_used_days REAL NOT NULL DEFAULT 0');
  }
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
