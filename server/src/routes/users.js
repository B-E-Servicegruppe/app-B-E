/**
 * Mitarbeiterverwaltung – ausschließlich für Administratoren.
 *
 *   GET   /api/users              – alle Konten (aktiv und deaktiviert)
 *   GET   /api/users/assignable   – aktive Mitarbeiter für Auswahlfelder
 *   POST  /api/users              – neues Konto anlegen
 *   PUT   /api/users/:id          – Stammdaten bearbeiten
 *   PATCH /api/users/:id/active   – aktivieren / deaktivieren
 *   POST  /api/users/:id/password – neues Initialpasswort setzen
 *
 * Konten werden nie gelöscht, nur deaktiviert – so bleibt die Auftragshistorie
 * (wer hat wann welchen Auftrag erledigt) vollständig nachvollziehbar.
 */
import express from 'express';
import { z } from 'zod';
import { db, now } from '../db/index.js';
import { asyncHandler, badRequest, conflict, notFound, validate } from '../lib/http.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { generateInitialPassword, hashPassword } from '../lib/security.js';
import { publicUser } from './auth.js';

export const usersRouter = express.Router();

usersRouter.use(requireAuth);

/**
 * Aktive Mitarbeiter für Auswahlfelder (Auftragszuweisung, Dienstplan).
 * Diese Liste ist bewusst auch für Mitarbeiter lesbar – sie enthält nur
 * Name und ID, keine Auftragsdaten – damit Namen in geteilten Aufträgen
 * angezeigt werden können.
 */
usersRouter.get(
  '/assignable',
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        "SELECT id, name FROM users WHERE role = 'EMPLOYEE' AND active = 1 ORDER BY name COLLATE NOCASE"
      )
      .all();
    res.json({ users: rows });
  })
);

// Ab hier: nur Administration
usersRouter.use(requireAdmin);

// ── Liste ────────────────────────────────────────────────────────────────────
usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare('SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE')
      .all();

    res.json({
      users: rows.map((user) => ({
        ...publicUser(user),
        createdAt: user.created_at,
        // Kennzahl für die Übersicht: wie viele Aufträge laufen aktuell?
        openOrders: db
          .prepare(
            `SELECT COUNT(*) AS c FROM order_assignments a
               JOIN orders o ON o.id = a.order_id
              WHERE a.user_id = ? AND o.status IN ('OFFEN', 'IN_ARBEIT')`
          )
          .get(user.id).c,
      })),
    });
  })
);

// ── Anlegen ──────────────────────────────────────────────────────────────────
const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Bitte Namen angeben'),
  email: z.string().trim().email('Bitte gültige E-Mail-Adresse angeben'),
  phone: z.string().trim().max(60).optional().nullable(),
  role: z.enum(['ADMIN', 'EMPLOYEE']).default('EMPLOYEE'),
  /** Optional – wird sonst automatisch erzeugt. */
  password: z.string().min(8, 'Das Passwort muss mindestens 8 Zeichen lang sein').optional(),
});

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = validate(createUserSchema, req.body);

    const exists = db.prepare('SELECT 1 AS ok FROM users WHERE email = ?').get(data.email);
    if (exists) throw conflict('Diese E-Mail-Adresse wird bereits verwendet');

    // Wenn kein Passwort vorgegeben wurde, erzeugt der Server eines und gibt es
    // einmalig zurück, damit der Admin es dem Mitarbeiter mitteilen kann.
    const initialPassword = data.password || generateInitialPassword();

    const info = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, phone, active, must_change_password)
         VALUES (?, ?, ?, ?, ?, 1, 1)`
      )
      .run(data.name, data.email, await hashPassword(initialPassword), data.role, data.phone ?? null);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({
      user: publicUser(user),
      // Nur hier – das Klartextpasswort wird nirgends gespeichert.
      initialPassword,
    });
  })
);

// ── Bearbeiten ───────────────────────────────────────────────────────────────
const updateUserSchema = z.object({
  name: z.string().trim().min(1, 'Bitte Namen angeben'),
  email: z.string().trim().email('Bitte gültige E-Mail-Adresse angeben'),
  phone: z.string().trim().max(60).optional().nullable(),
  role: z.enum(['ADMIN', 'EMPLOYEE']),
});

usersRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) throw notFound('Benutzer nicht gefunden');

    const data = validate(updateUserSchema, req.body);

    const emailTaken = db
      .prepare('SELECT 1 AS ok FROM users WHERE email = ? AND id != ?')
      .get(data.email, id);
    if (emailTaken) throw conflict('Diese E-Mail-Adresse wird bereits verwendet');

    // Der letzte aktive Admin darf nicht zum Mitarbeiter herabgestuft werden –
    // sonst wäre niemand mehr verwaltungsberechtigt.
    if (existing.role === 'ADMIN' && data.role !== 'ADMIN' && countActiveAdmins() <= 1) {
      throw badRequest('Es muss mindestens ein aktiver Administrator vorhanden sein');
    }

    db.prepare('UPDATE users SET name = ?, email = ?, phone = ?, role = ?, updated_at = ? WHERE id = ?')
      .run(data.name, data.email, data.phone ?? null, data.role, now(), id);

    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  })
);

// ── Aktivieren / Deaktivieren ────────────────────────────────────────────────
usersRouter.patch(
  '/:id/active',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('Benutzer nicht gefunden');

    const { active } = validate(z.object({ active: z.boolean() }), req.body);

    if (!active && user.id === req.user.id) {
      throw badRequest('Das eigene Konto kann nicht deaktiviert werden');
    }
    if (!active && user.role === 'ADMIN' && countActiveAdmins() <= 1) {
      throw badRequest('Es muss mindestens ein aktiver Administrator vorhanden sein');
    }

    db.prepare('UPDATE users SET active = ?, updated_at = ? WHERE id = ?').run(
      active ? 1 : 0,
      now(),
      id
    );

    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  })
);

// ── Passwort zurücksetzen (Admin vergibt neues Initialpasswort) ──────────────
usersRouter.post(
  '/:id/password',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('Benutzer nicht gefunden');

    const parsed = validate(
      z.object({ password: z.string().min(8, 'Mindestens 8 Zeichen').optional() }),
      req.body ?? {}
    );
    const newPassword = parsed.password || generateInitialPassword();

    db.prepare(
      'UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?'
    ).run(await hashPassword(newPassword), now(), id);

    res.json({ initialPassword: newPassword });
  })
);

/** @returns {number} Anzahl aktiver Administratoren */
function countActiveAdmins() {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'ADMIN' AND active = 1").get().c;
}
