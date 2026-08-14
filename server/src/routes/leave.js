/**
 * Urlaubsverwaltung.
 *
 *   GET    /api/leave/requests             – eigene Anträge (Mitarbeiter)
 *                                             bzw. alle Anträge (Admin, ?status=)
 *   POST   /api/leave/requests              – Antrag stellen (jeder angemeldete Benutzer)
 *   DELETE /api/leave/requests/:id          – eigenen noch offenen Antrag zurückziehen,
 *                                             oder (Admin) einen bereits genehmigten widerrufen
 *   PATCH  /api/leave/requests/:id/decision – genehmigen/ablehnen           (nur Admin)
 *
 *   GET    /api/leave/allowances?year=      – Kontingent + Verbrauch je Mitarbeiter (nur Admin)
 *   PUT    /api/leave/allowances/:userId    – Kontingent setzen              (nur Admin)
 *
 * Kernidee: Der "Verbrauch" wird nie als eigene Zahl gespeichert, sondern
 * immer live aus den genehmigten Anträgen berechnet (SUM je Jahr) – dadurch
 * kann er nie aus dem Takt geraten, egal was mit einzelnen Anträgen passiert.
 */
import express from 'express';
import { z } from 'zod';
import { db, now } from '../db/index.js';
import { asyncHandler, badRequest, forbidden, notFound, validate } from '../lib/http.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

export const leaveRouter = express.Router();

leaveRouter.use(requireAuth);

/** Arbeitstage (Mo–Fr) zwischen zwei Datumsangaben, jeweils eingeschlossen. */
function countBusinessDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const weekday = cursor.getUTCDay(); // 0 = Sonntag, 6 = Samstag
    if (weekday !== 0 && weekday !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function mapRequest(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name ?? null,
    startDate: row.start_date,
    endDate: row.end_date,
    daysCount: row.days_count,
    reason: row.reason,
    status: row.status,
    decisionNote: row.decision_note,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

/** Erzeugt/entfernt die zu einem Urlaubsantrag gehörenden Dienstplan-Einträge. */
function syncShiftsForLeaveRequest(requestId) {
  const request = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(requestId);
  if (!request || request.status !== 'APPROVED') {
    db.prepare('DELETE FROM shifts WHERE leave_request_id = ?').run(requestId);
    return;
  }
  const existingDates = new Set(
    db
      .prepare('SELECT date FROM shifts WHERE leave_request_id = ?')
      .all(requestId)
      .map((r) => r.date)
  );

  const insert = db.prepare(
    `INSERT INTO shifts (user_id, date, title, kind, leave_request_id, created_by)
     VALUES (?, ?, 'Urlaub', 'LEAVE', ?, ?)`
  );

  const start = new Date(`${request.start_date}T00:00:00Z`);
  const end = new Date(`${request.end_date}T00:00:00Z`);
  const cursor = new Date(start);
  while (cursor <= end) {
    const weekday = cursor.getUTCDay();
    const dateStr = cursor.toISOString().slice(0, 10);
    // Nur Arbeitstage bekommen einen Eintrag – am Wochenende ist ohnehin frei.
    if (weekday !== 0 && weekday !== 6 && !existingDates.has(dateStr)) {
      insert.run(request.user_id, dateStr, requestId, request.decided_by ?? request.user_id);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

// ── Anträge: Liste ───────────────────────────────────────────────────────────
leaveRouter.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const isAdminUser = req.user.role === 'ADMIN';
    const statusFilter = ['PENDING', 'APPROVED', 'REJECTED'].includes(req.query.status)
      ? req.query.status
      : null;

    const where = [];
    const params = [];
    if (!isAdminUser) {
      where.push('lr.user_id = ?');
      params.push(req.user.id);
    }
    if (statusFilter) {
      where.push('lr.status = ?');
      params.push(statusFilter);
    }

    const rows = db
      .prepare(
        `SELECT lr.*, u.name AS user_name FROM leave_requests lr
           JOIN users u ON u.id = lr.user_id
           ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY lr.status = 'PENDING' DESC, lr.created_at DESC`
      )
      .all(...params);

    res.json({ requests: rows.map(mapRequest) });
  })
);

// ── Anträge: stellen ─────────────────────────────────────────────────────────
const requestSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT'),
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'Das Enddatum muss nach dem Startdatum liegen',
    path: ['endDate'],
  });

leaveRouter.post(
  '/requests',
  asyncHandler(async (req, res) => {
    const data = validate(requestSchema, req.body);
    const daysCount = countBusinessDays(data.startDate, data.endDate);
    if (daysCount === 0) {
      throw badRequest('Der gewählte Zeitraum enthält keinen Arbeitstag (Mo–Fr).');
    }

    const info = db
      .prepare(
        `INSERT INTO leave_requests (user_id, start_date, end_date, days_count, reason)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(req.user.id, data.startDate, data.endDate, daysCount, data.reason || null);

    const row = db
      .prepare(
        `SELECT lr.*, u.name AS user_name FROM leave_requests lr
           JOIN users u ON u.id = lr.user_id WHERE lr.id = ?`
      )
      .get(info.lastInsertRowid);
    res.status(201).json({ request: mapRequest(row) });
  })
);

// ── Anträge: genehmigen / ablehnen (nur Admin) ───────────────────────────────
const decisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED'], { message: 'Bitte Entscheidung angeben' }),
  note: z.string().trim().max(500).optional().nullable(),
});

leaveRouter.patch(
  '/requests/:id/decision',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const request = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
    if (!request) throw notFound('Antrag nicht gefunden');
    if (request.status !== 'PENDING') {
      throw badRequest('Über diesen Antrag wurde bereits entschieden.');
    }
    const { decision, note } = validate(decisionSchema, req.body);

    db.transaction(() => {
      db.prepare(
        `UPDATE leave_requests
            SET status = ?, decision_note = ?, decided_by = ?, decided_at = ?
          WHERE id = ?`
      ).run(decision, note || null, req.user.id, now(), id);

      // Bei Genehmigung: Dienstplan-Einträge automatisch anlegen – sichtbar
      // bei der Administration UND beim betroffenen Mitarbeiter.
      syncShiftsForLeaveRequest(id);
    })();

    const row = db
      .prepare(
        `SELECT lr.*, u.name AS user_name FROM leave_requests lr
           JOIN users u ON u.id = lr.user_id WHERE lr.id = ?`
      )
      .get(id);
    res.json({ request: mapRequest(row) });
  })
);

// ── Anträge: zurückziehen/widerrufen ─────────────────────────────────────────
leaveRouter.delete(
  '/requests/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const request = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
    if (!request) throw notFound('Antrag nicht gefunden');

    const isAdminUser = req.user.role === 'ADMIN';
    const isOwner = request.user_id === req.user.id;
    if (!isAdminUser && !isOwner) throw forbidden();
    // Mitarbeiter dürfen nur noch offene eigene Anträge zurückziehen; einen
    // bereits genehmigten/abgelehnten Antrag löschen kann nur die Administration
    // (z. B. um genehmigten Urlaub wieder zu widerrufen).
    if (!isAdminUser && request.status !== 'PENDING') {
      throw forbidden('Über diesen Antrag wurde bereits entschieden – bitte die Administration kontaktieren.');
    }

    db.transaction(() => {
      db.prepare('DELETE FROM shifts WHERE leave_request_id = ?').run(id);
      db.prepare('DELETE FROM leave_requests WHERE id = ?').run(id);
    })();

    res.json({ ok: true });
  })
);

// ── Kontingente (nur Admin) ──────────────────────────────────────────────────
leaveRouter.get(
  '/allowances',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();

    const employees = db
      .prepare("SELECT id, name, active FROM users WHERE role = 'EMPLOYEE' ORDER BY name COLLATE NOCASE")
      .all();

    const allowanceByUser = new Map(
      db
        .prepare('SELECT user_id, days_total FROM leave_allowances WHERE year = ?')
        .all(year)
        .map((r) => [r.user_id, r.days_total])
    );
    const usedByUser = new Map(
      db
        .prepare(
          `SELECT user_id, SUM(days_count) AS used FROM leave_requests
             WHERE status = 'APPROVED' AND substr(start_date, 1, 4) = ?
             GROUP BY user_id`
        )
        .all(String(year))
        .map((r) => [r.user_id, r.used])
    );

    res.json({
      year,
      employees: employees.map((e) => {
        const total = allowanceByUser.get(e.id) ?? 0;
        const used = usedByUser.get(e.id) ?? 0;
        return {
          userId: e.id,
          name: e.name,
          active: Boolean(e.active),
          daysTotal: total,
          daysUsed: used,
          daysRemaining: Math.round((total - used) * 100) / 100,
        };
      }),
    });
  })
);

const allowanceSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  daysTotal: z.number().min(0).max(365),
});

leaveRouter.put(
  '/allowances/:userId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    const employee = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'EMPLOYEE'").get(userId);
    if (!employee) throw notFound('Mitarbeiter nicht gefunden');

    const { year, daysTotal } = validate(allowanceSchema, req.body);
    db.prepare(
      `INSERT INTO leave_allowances (user_id, year, days_total) VALUES (?, ?, ?)
         ON CONFLICT (user_id, year) DO UPDATE SET days_total = excluded.days_total`
    ).run(userId, year, daysTotal);

    res.json({ ok: true });
  })
);

export { countBusinessDays };
