-- =============================================================================
-- B&E Service Gruppe – Datenbankschema (SQLite)
-- =============================================================================
-- Dieses Schema wird beim Serverstart automatisch angewendet (idempotent, d.h.
-- es kann beliebig oft ausgeführt werden). Für spätere Erweiterungen (z. B. ein
-- Rechnungsmodul) einfach neue Tabellen ergänzen bzw. eine Migration in
-- server/src/db/migrations anlegen.
--
-- Konventionen:
--   * Alle Zeitstempel als ISO-8601-Text in UTC  (z. B. 2026-08-11T07:30:00.000Z)
--   * Alle reinen Datumsangaben als 'YYYY-MM-DD' (lokales Datum, Europe/Berlin)
--   * Uhrzeiten als 'HH:MM'
--   * Booleans als INTEGER 0/1
-- =============================================================================

PRAGMA journal_mode = WAL;   -- bessere Parallelität bei gleichzeitigen Zugriffen
PRAGMA foreign_keys = ON;    -- referenzielle Integrität erzwingen

-- -----------------------------------------------------------------------------
-- BENUTZER & ROLLEN
-- -----------------------------------------------------------------------------
-- Es gibt genau zwei Rollen: 'ADMIN' (Geschäftsführung) und 'EMPLOYEE'
-- (Mitarbeiter). Konten werden ausschließlich von Admins angelegt – es gibt
-- bewusst keine Selbstregistrierung.
-- Deaktivierte Konten werden NICHT gelöscht (active = 0), damit die
-- Auftragshistorie vollständig erhalten bleibt.
CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL,
  email                TEXT    NOT NULL UNIQUE COLLATE NOCASE, -- dient als Benutzername
  password_hash        TEXT    NOT NULL,                       -- bcrypt-Hash, nie Klartext
  role                 TEXT    NOT NULL CHECK (role IN ('ADMIN', 'EMPLOYEE')),
  phone                TEXT,
  -- Private E-Mail-Adresse (optional). Wird für "Passwort vergessen" genutzt,
  -- damit der Reset nicht von der Erreichbarkeit der Firmenmail abhängt.
  private_email        TEXT,
  active               INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Tokens für "Passwort vergessen". Gespeichert wird nur der SHA-256-Hash des
-- Tokens – der Klartext-Token existiert ausschließlich im Reset-Link.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  used_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id);

-- -----------------------------------------------------------------------------
-- KUNDEN / OBJEKTE
-- -----------------------------------------------------------------------------
-- Wiederverwendbare Stammdaten. Beim Anlegen eines Auftrags kann ein Kunde
-- ausgewählt werden – Name/Adresse/Telefon werden dann automatisch übernommen
-- (und bleiben zusätzlich als Momentaufnahme direkt am Auftrag gespeichert,
-- damit sich spätere Änderungen am Kunden nicht rückwirkend auf alte,
-- bereits abgeschlossene Aufträge auswirken).
CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  address       TEXT,
  contact_phone TEXT,
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name COLLATE NOCASE);

-- -----------------------------------------------------------------------------
-- WIEDERKEHRENDE AUFTRÄGE (SERIEN)
-- -----------------------------------------------------------------------------
-- Eine Serie ist die "Vorlage" (z. B. "jeden Montag Treppenhaus reinigen").
-- Beim Anlegen einer Serie werden die einzelnen orders-Zeilen für den
-- gewählten Zeitraum sofort erzeugt (siehe order_series_id an orders) – jeder
-- Termin bleibt danach ein ganz normaler, einzeln bearbeitbarer Auftrag.
CREATE TABLE IF NOT EXISTS order_series (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT    NOT NULL,
  address       TEXT    NOT NULL,
  contact_phone TEXT,
  order_type    TEXT    NOT NULL CHECK (order_type IN
                  ('REINIGUNG', 'GARTEN', 'ABRISS', 'WINTERDIENST', 'ENTRUEMPELUNG')),
  -- Unterart innerhalb der Auftragsart, z. B. "Grundreinigung" bei Reinigung.
  -- Frei befüllbar (Vorschlagsliste kommt aus dem Frontend), damit neue
  -- Unterarten keine Code-Änderung erfordern.
  subtype       TEXT,
  notes         TEXT,
  interval_type TEXT    NOT NULL CHECK (interval_type IN ('WEEKLY', 'BIWEEKLY', 'MONTHLY')),
  -- Kommagetrennte Liste von Wochentagen, z. B. "0,3" für Montag+Donnerstag.
  -- 0=Montag … 6=Sonntag. Nur für WEEKLY/BIWEEKLY genutzt (bei MONTHLY zählt
  -- stattdessen der Tag im Monat von start_date).
  weekdays      TEXT,
  start_time    TEXT,
  end_time      TEXT,
  start_date    TEXT    NOT NULL,          -- 'YYYY-MM-DD' – erster Termin
  end_date      TEXT    NOT NULL,          -- 'YYYY-MM-DD' – aktueller Terminhorizont
  -- Läuft die Serie ohne festes Enddatum ("bis auf Weiteres")? end_date
  -- enthält dann trotzdem einen konkreten Wert (den aktuell erzeugten
  -- Horizont, siehe order-series.js), damit keine NULL-Sonderfälle in der
  -- Terminberechnung nötig sind. Die Serie kann über /extend beliebig oft um
  -- weitere Zeiträume verlängert werden.
  open_ended    INTEGER NOT NULL DEFAULT 0 CHECK (open_ended IN (0, 1)),
  -- Kommagetrennte Mitarbeiter-IDs, die bei Anlage zugewiesen wurden – wird
  -- beim Verlängern (/extend) erneut auf die neu erzeugten Termine angewendet.
  assignee_ids  TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- -----------------------------------------------------------------------------
-- AUFTRÄGE
-- -----------------------------------------------------------------------------
-- order_type:  Reinigung | Garten | Abriss | Winterdienst | Entrümpelung
-- status:      OFFEN -> IN_ARBEIT -> ERLEDIGT  (jederzeit STORNIERT möglich)
CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name  TEXT    NOT NULL,
  address        TEXT    NOT NULL,          -- einzeilige Adresse für Google-Maps-Link
  contact_phone  TEXT,
  -- Verweis auf den ausgewählten Kunden (optional – Auftrag funktioniert auch
  -- ganz ohne Kundenstamm, mit frei eingetippten Angaben oben).
  customer_id    INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  -- Verweis auf die erzeugende Serie, falls der Auftrag aus einer
  -- wiederkehrenden Vorlage stammt.
  series_id      INTEGER REFERENCES order_series(id) ON DELETE SET NULL,
  order_type     TEXT    NOT NULL CHECK (order_type IN
                   ('REINIGUNG', 'GARTEN', 'ABRISS', 'WINTERDIENST', 'ENTRUEMPELUNG')),
  -- Unterart innerhalb der Auftragsart, z. B. "Bauendreinigung". Frei
  -- befüllbar, siehe order_series.subtype weiter oben für die Begründung.
  subtype        TEXT,
  status         TEXT    NOT NULL DEFAULT 'OFFEN' CHECK (status IN
                   ('OFFEN', 'IN_ARBEIT', 'ERLEDIGT', 'STORNIERT')),
  scheduled_date TEXT,                      -- 'YYYY-MM-DD'
  start_time     TEXT,                      -- 'HH:MM' – Beginn Zeitfenster
  end_time       TEXT,                      -- 'HH:MM' – Ende Zeitfenster
  notes          TEXT,                      -- Notizen des Admins für das Team
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date   ON orders(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_orders_type   ON orders(order_type);
-- Hinweis: Die Indizes auf orders.customer_id und orders.series_id werden in
-- src/db/index.js (migrateAddColumns) angelegt – NACH dem ALTER TABLE, das die
-- Spalten auf bestehenden Datenbanken erst ergänzt. Stünden sie hier, würde
-- dieses Schema auf einer bestehenden Datenbank mit "no such column" scheitern,
-- bevor die Migration überhaupt läuft.

-- Zuweisung Auftrag <-> Mitarbeiter (n:m, ein Auftrag kann mehrere Mitarbeiter
-- haben und umgekehrt). Diese Tabelle ist die Grundlage der serverseitigen
-- Rechteprüfung: Ein Mitarbeiter sieht einen Auftrag nur, wenn hier ein
-- Eintrag mit seiner user_id existiert.
CREATE TABLE IF NOT EXISTS order_assignments (
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (order_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_assignments_user ON order_assignments(user_id);

-- Benötigtes Material – dient dem Mitarbeiter gleichzeitig als Checkliste.
CREATE TABLE IF NOT EXISTS order_materials (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name     TEXT    NOT NULL,
  quantity TEXT,                                        -- frei, z. B. "2 Sack" / "10 m"
  done     INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0                   -- Sortierreihenfolge
);
CREATE INDEX IF NOT EXISTS idx_materials_order ON order_materials(order_id);

-- Dateianhänge. kind = 'ATTACHMENT' (Angebot/Grundriss/Referenzfoto, vom Admin)
-- oder 'PROOF_PHOTO' (Abschluss-Nachweis, vom Mitarbeiter).
-- Die Datei selbst liegt unter server/uploads/<stored_name>; in der Datenbank
-- stehen nur die Metadaten.
CREATE TABLE IF NOT EXISTS order_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind          TEXT    NOT NULL DEFAULT 'ATTACHMENT'
                        CHECK (kind IN ('ATTACHMENT', 'PROOF_PHOTO')),
  original_name TEXT    NOT NULL,
  stored_name   TEXT    NOT NULL,   -- zufälliger Dateiname auf der Platte
  mime_type     TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_files_order ON order_files(order_id);

-- Lückenlose Statushistorie inkl. Zeitstempel und auslösendem Benutzer.
CREATE TABLE IF NOT EXISTS order_status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,                       -- NULL beim Anlegen des Auftrags
  to_status   TEXT    NOT NULL,
  changed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_history_order ON order_status_history(order_id);

-- Rückmeldungen des Mitarbeiters an den Admin (und umgekehrt).
CREATE TABLE IF NOT EXISTS order_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_order ON order_comments(order_id);

-- -----------------------------------------------------------------------------
-- URLAUB
-- -----------------------------------------------------------------------------
-- Ein Mitarbeiter stellt einen Antrag (PENDING). Die Administration bestätigt
-- oder lehnt ihn ab. Bei Bestätigung erzeugt der Server automatisch
-- Dienstplan-Einträge (shifts.kind = 'LEAVE') für den Zeitraum – sichtbar bei
-- der Administration UND beim betroffenen Mitarbeiter.
--
-- Der Verbrauch (wie viele Tage schon genommen) wird bewusst NICHT als eigene
-- Zahl gespeichert, sondern immer aus den genehmigten Anträgen berechnet
-- (SUM der days_count je Jahr) – so kann er nie aus dem Takt geraten.
CREATE TABLE IF NOT EXISTS leave_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date    TEXT    NOT NULL,          -- 'YYYY-MM-DD'
  end_date      TEXT    NOT NULL,          -- 'YYYY-MM-DD'
  -- Arbeitstage (Mo–Fr) im Zeitraum, serverseitig berechnet – Wochenenden
  -- zählen bewusst nicht als Urlaubstag.
  days_count    REAL    NOT NULL,
  reason        TEXT,
  status        TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  decision_note TEXT,
  decided_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_user ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);

-- Jährliches Urlaubskontingent je Mitarbeiter (von der Administration
-- gepflegt). Kein Eintrag für ein Jahr = 0 Tage Kontingent.
CREATE TABLE IF NOT EXISTS leave_allowances (
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year             INTEGER NOT NULL,
  days_total       REAL    NOT NULL DEFAULT 0,
  -- Manuell erfasste, bereits genommene Tage – für Urlaub, der VOR oder
  -- AUSSERHALB der App genommen wurde (z. B. schon verbrauchter Urlaub beim
  -- Umstieg auf dieses System). Wird zum automatisch aus genehmigten
  -- Anträgen berechneten Verbrauch addiert, ersetzt ihn aber nicht.
  manual_used_days REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year)
);

-- -----------------------------------------------------------------------------
-- DIENSTPLAN
-- -----------------------------------------------------------------------------
-- Ein Eintrag = ein Mitarbeiter an einem Tag in einem Zeitfenster.
-- order_id ist optional: Einträge können mit einem Auftrag verknüpft sein
-- (dann erbt die Farbe die Auftragsart) oder frei sein (z. B. "Urlaub",
-- "Werkstatt", "Bereitschaft Winterdienst").
CREATE TABLE IF NOT EXISTS shifts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  date       TEXT    NOT NULL,             -- 'YYYY-MM-DD'
  start_time TEXT,                         -- 'HH:MM'
  end_time   TEXT,                         -- 'HH:MM'
  title      TEXT,                         -- freier Titel, falls kein Auftrag
  note       TEXT,
  -- WORK = normaler Einsatz (Auftrag oder freier Eintrag),
  -- LEAVE = automatisch aus einem genehmigten Urlaubsantrag erzeugt.
  kind             TEXT NOT NULL DEFAULT 'WORK' CHECK (kind IN ('WORK', 'LEAVE')),
  leave_request_id INTEGER REFERENCES leave_requests(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_shifts_user ON shifts(user_id, date);
