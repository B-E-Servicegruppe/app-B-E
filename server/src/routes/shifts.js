/**
 * Dienstplan.
 *
 *   GET    /api/shifts?from=&to=[&userId=]  – Einträge im Zeitraum
 *   POST   /api/shifts                      – Eintrag anlegen      (nur Admin)
 *   PUT    /api/shifts/:id                  – Eintrag bearbeiten   (nur Admin)
 *   PATCH  /api/shifts/:id/move             – per Drag & Drop verschieben (nur Admin)
 *   DELETE /api/shifts/:id                  – Eintrag löschen      (nur Admin)
 *
 * Mitarbeiter erhalten hier ausschließlich ihre eigenen Einträge (read-only).
 * Die Einschränkung erfolgt serverseitig – ein manuell gesetzter userId-Filter
 * in der URL wird für Mitarbeiter ignoriert bzw. überschrieben.
 */
import express from 'express';
import { z } from 'zod';
import { db, now } from '../db/index.js';
import { asyncHandler, notFound, validate } from '../lib/http.js';
import { isAdmin, requireAdmin, requireAuth } from '../middleware/auth.js';

export const shiftsRouter = express.Router();

shiftsRouter.use(requireAuth);

const shiftSchema = z.object({
  userId: z.number().int().positive('Bitte Mitarbeiter wählen'),
  orderId: z.number().int().positive().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Uhrzeit im Format HH:MM').optional().nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Uhrzeit im Format HH:MM').optional().nullable(),
  title: z.string().trim().max(200).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

/**
 * Setzt einen Dienstplan-Eintrag mit den Daten des verknüpften Auftrags
 * zusammen – das Frontend kann so direkt Auftragsart (Farbe), Status, Kunde
 * und Adresse anzeigen, ohne jeden Auftrag einzeln nachzuladen.
 */
function mapShift(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    orderId: row.order_id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    title: row.title,
    note: row.note,
    kind: row.kind,
    order: row.order_id
      ? {
          id: row.order_id,
          customerName: row.customer_name,
          address: row.address,
          orderType: row.order_type,
          status: row.status,
        }
      : null,
  };
}

const SELECT_SHIFT = `
  SELECT s.*, u.name AS user_name,
         o.customer_name, o.address, o.order_type, o.status
    FROM shifts s
    JOIN users u ON u.id = s.user_id
LEFT JOIN orders o ON o.id = s.order_id
`;

// ── Liste ────────────────────────────────────────────────────────────────────
shiftsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];

    // Rechteprüfung: Mitarbeiter sehen ausschließlich die eigene Einteilung.
    if (!isAdmin(req.user)) {
      where.push('s.user_id = ?');
      params.push(req.user.id);
    } else if (req.query.userId) {
      where.push('s.user_id = ?');
      params.push(Number(req.query.userId));
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')) {
      where.push('s.date >= ?');
      params.push(req.query.from);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')) {
      where.push('s.date <= ?');
      params.push(req.query.to);
    }

    const rows = db
      .prepare(
        `${SELECT_SHIFT}
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY s.date, COALESCE(s.start_time, '99:99'), s.id`
      )
      .all(...params);

    res.json({ shifts: rows.map(mapShift) });
  })
);

// ── Anlegen (nur Admin) ──────────────────────────────────────────────────────
shiftsRouter.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const data = validate(shiftSchema, req.body);
    ensureUserExists(data.userId);
    if (data.orderId) ensureOrderExists(data.orderId);

    const info = db
      .prepare(
        `INSERT INTO shifts (user_id, order_id, date, start_time, end_time, title, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.userId,
        data.orderId ?? null,
        data.date,
        data.startTime ?? null,
        data.endTime ?? null,
        data.title?.trim() || null,
        data.note ?? null,
        req.user.id
      );

    res.status(201).json({ shift: loadShift(Number(info.lastInsertRowid)) });
  })
);

// ── Bearbeiten (nur Admin) ───────────────────────────────────────────────────
shiftsRouter.put(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 AS ok FROM shifts WHERE id = ?').get(id)) {
      throw notFound('Dienstplan-Eintrag nicht gefunden');
    }

    const data = validate(shiftSchema, req.body);
    ensureUserExists(data.userId);
    if (data.orderId) ensureOrderExists(data.orderId);

    db.prepare(
      `UPDATE shifts
          SET user_id = ?, order_id = ?, date = ?, start_time = ?, end_time = ?,
              title = ?, note = ?, updated_at = ?
        WHERE id = ?`
    ).run(
      data.userId,
      data.orderId ?? null,
      data.date,
      data.startTime ?? null,
      data.endTime ?? null,
      data.title?.trim() || null,
      data.note ?? null,
      now(),
      id
    );

    res.json({ shift: loadShift(id) });
  })
);

// ── Verschieben per Drag & Drop (nur Admin) ──────────────────────────────────
/**
 * Kompakte Route für den Kalender: Ein Eintrag wird auf einen anderen Tag
 * (und optional auf einen anderen Mitarbeiter) gezogen.
 */
shiftsRouter.patch(
  '/:id/move',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
    if (!shift) throw notFound('Dienstplan-Eintrag nicht gefunden');

    const data = validate(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT'),
        userId: z.number().int().positive().optional(),
      }),
      req.body
    );
    if (data.userId) ensureUserExists(data.userId);

    db.prepare('UPDATE shifts SET date = ?, user_id = ?, updated_at = ? WHERE id = ?').run(
      data.date,
      data.userId ?? shift.user_id,
      now(),
      id
    );

    res.json({ shift: loadShift(id) });
  })
);

// ── Löschen (nur Admin) ──────────────────────────────────────────────────────
shiftsRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const info = db.prepare('DELETE FROM shifts WHERE id = ?').run(Number(req.params.id));
    if (info.changes === 0) throw notFound('Dienstplan-Eintrag nicht gefunden');
    res.json({ ok: true });
  })
);

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────
function loadShift(id) {
  return mapShift(db.prepare(`${SELECT_SHIFT} WHERE s.id = ?`).get(id));
}

function ensureUserExists(userId) {
  if (!db.prepare('SELECT 1 AS ok FROM users WHERE id = ? AND active = 1').get(userId)) {
    throw notFound('Mitarbeiter nicht gefunden oder deaktiviert');
  }
}

function ensureOrderExists(orderId) {
  if (!db.prepare('SELECT 1 AS ok FROM orders WHERE id = ?').get(orderId)) {
    throw notFound('Auftrag nicht gefunden');
  }
}
