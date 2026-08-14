/**
 * Wiederkehrende Aufträge ("Serien").
 *
 *   GET    /api/order-series        – Liste aller Serien              (nur Admin)
 *   POST   /api/order-series        – Serie anlegen (erzeugt sofort alle
 *                                      Einzeltermine als ganz normale Aufträge)
 *   DELETE /api/order-series/:id    – Serie beenden (storniert alle noch
 *                                      offenen zukünftigen Termine, bereits
 *                                      erledigte/laufende bleiben unangetastet)
 *
 * Bewusster Designentscheid: Es gibt KEINEN Hintergrundjob, der laufend neue
 * Termine nachschiebt. Stattdessen werden beim einmaligen Anlegen der Serie
 * sofort alle Termine bis zum gewählten Enddatum als eigenständige Aufträge
 * erzeugt (max. 2 Jahre / 208 Termine als Sicherheitsgrenze). Jeder einzelne
 * Termin ist danach ein ganz normaler Auftrag – er kann wie jeder andere auch
 * bearbeitet, verschoben, zugewiesen oder storniert werden, ohne die übrigen
 * Termine der Serie zu beeinflussen.
 */
import express from 'express';
import { z } from 'zod';
import { db, now } from '../db/index.js';
import { asyncHandler, badRequest, notFound, validate } from '../lib/http.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { ORDER_TYPES, syncShiftsForOrder } from './orders.js';

export const orderSeriesRouter = express.Router();

orderSeriesRouter.use(requireAuth, requireAdmin);

const MAX_OCCURRENCES = 400; // z. B. 2x/Woche über 2 Jahre = ~208 – reichlich Sicherheitsmarge
const MAX_HORIZON_DAYS = 365 * 2;

const seriesSchema = z
  .object({
    customerId: z.number().int().positive().optional().nullable(),
    customerName: z.string().trim().min(1, 'Bitte Kundenname angeben'),
    address: z.string().trim().min(1, 'Bitte Adresse angeben'),
    contactPhone: z.string().trim().max(60).optional().nullable(),
    orderType: z.enum(ORDER_TYPES, { message: 'Bitte Auftragsart wählen' }),
    subtype: z.string().trim().max(120).optional().nullable(),
    notes: z.string().max(5000).optional().nullable(),
    intervalType: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY'], {
      message: 'Bitte Intervall wählen',
    }),
    // 0 = Montag … 6 = Sonntag. Ein oder mehrere Wochentage möglich, z. B.
    // [0, 3] für "jeden Montag UND Donnerstag". Pflicht für wöchentlich/
    // alle 2 Wochen, wird bei monatlich ignoriert (dort zählt der Tag im
    // Monat von startDate).
    weekdays: z.array(z.number().int().min(0).max(6)).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT'),
    // Fehlt endDate, läuft die Serie ohne festes Enddatum ("bis auf
    // Weiteres") – es wird automatisch ein Terminhorizont von einem Jahr
    // erzeugt, der sich später über /extend beliebig verlängern lässt.
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT')
      .optional()
      .nullable(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Uhrzeit im Format HH:MM').optional().nullable(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Uhrzeit im Format HH:MM').optional().nullable(),
    assigneeIds: z.array(z.number().int().positive()).optional(),
  })
  .refine((data) => !data.endDate || data.endDate >= data.startDate, {
    message: 'Das Enddatum muss nach dem Startdatum liegen',
    path: ['endDate'],
  })
  .refine((data) => data.intervalType === 'MONTHLY' || (data.weekdays && data.weekdays.length > 0), {
    message: 'Bitte mindestens einen Wochentag wählen',
    path: ['weekdays'],
  });

/** Ein Jahr in Tagen – Standard-Terminhorizont für Serien ohne Enddatum. */
const OPEN_ENDED_HORIZON_DAYS = 365;

/** Datum als 'YYYY-MM-DD' plus n Tage, ohne Zeitzonen-Verschiebung. */
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Erzeugt die Liste der Termin-Daten (YYYY-MM-DD) für eine Serie.
 *
 * `from` grenzt nur ein, AB WANN neue Termine erzeugt werden (wichtig beim
 * Verlängern einer laufenden Serie, damit keine bereits vorhandenen Termine
 * doppelt entstehen) – die Wochentags-/Monatstag-Logik bleibt aber immer an
 * `startDate` ausgerichtet, damit z. B. der 14-tägige Rhythmus nicht aus dem
 * Takt gerät, nur weil man ab einem späteren Datum weiterzählt.
 */
function generateDates({ intervalType, weekdays, startDate, endDate, from }) {
  const referenceStart = new Date(`${startDate}T00:00:00Z`);
  const iterStart = from ? new Date(`${from}T00:00:00Z`) : referenceStart;
  const end = new Date(`${endDate}T00:00:00Z`);

  if ((end - iterStart) / (1000 * 60 * 60 * 24) > MAX_HORIZON_DAYS) {
    throw badRequest(`Der Zeitraum darf maximal ${MAX_HORIZON_DAYS} Tage umfassen.`);
  }

  const dates = [];

  if (intervalType === 'MONTHLY') {
    const dayOfMonth = referenceStart.getUTCDate();
    const stepMonth = (d) => {
      const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      const daysInNext = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
      next.setUTCDate(Math.min(dayOfMonth, daysInNext));
      return next;
    };
    let cursor = new Date(referenceStart);
    // Von referenceStart aus monatsweise vorspulen, bis wir bei/nach iterStart sind
    // (relevant beim Verlängern, wo iterStart weit nach referenceStart liegt).
    while (cursor < iterStart) {
      cursor = stepMonth(cursor);
    }
    while (cursor <= end && dates.length < MAX_OCCURRENCES) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor = stepMonth(cursor);
    }
    return dates;
  }

  // WEEKLY / BIWEEKLY mit einem oder mehreren Wochentagen: Tag für Tag von
  // iterStart bis endDate durchgehen und jeden Tag aufnehmen, dessen
  // Wochentag in der Auswahl ist. Bei BIWEEKLY zusätzlich nur jede zweite
  // Woche, gezählt ab der Woche von referenceStart (nicht iterStart!), damit
  // der Rhythmus über Verlängerungen hinweg synchron bleibt.
  const weekdaySet = new Set(weekdays);
  // JS: getUTCDay() 0=Sonntag..6=Samstag → auf unser Schema 0=Montag..6=Sonntag umrechnen
  const jsToOurWeekday = (d) => (d.getUTCDay() + 6) % 7;

  const startWeekMonday = new Date(referenceStart);
  startWeekMonday.setUTCDate(startWeekMonday.getUTCDate() - jsToOurWeekday(startWeekMonday));

  const cursor = new Date(iterStart);
  while (cursor <= end && dates.length < MAX_OCCURRENCES) {
    if (weekdaySet.has(jsToOurWeekday(cursor))) {
      let include = true;
      if (intervalType === 'BIWEEKLY') {
        const cursorWeekMonday = new Date(cursor);
        cursorWeekMonday.setUTCDate(cursorWeekMonday.getUTCDate() - jsToOurWeekday(cursor));
        const weeksBetween = Math.round(
          (cursorWeekMonday - startWeekMonday) / (1000 * 60 * 60 * 24 * 7)
        );
        include = weeksBetween % 2 === 0;
      }
      if (include) dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function mapSeries(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    address: row.address,
    contactPhone: row.contact_phone,
    orderType: row.order_type,
    subtype: row.subtype,
    notes: row.notes,
    intervalType: row.interval_type,
    weekdays: row.weekdays ? row.weekdays.split(',').map(Number) : [],
    startTime: row.start_time,
    endTime: row.end_time,
    startDate: row.start_date,
    // Bei offenen Serien ist end_date nur der aktuelle, technische Horizont –
    // das Frontend zeigt hier "kein Enddatum" statt des Rohwerts an.
    endDate: row.end_date,
    openEnded: Boolean(row.open_ended),
    createdAt: row.created_at,
    occurrenceCount: db
      .prepare('SELECT COUNT(*) AS c FROM orders WHERE series_id = ?')
      .get(row.id).c,
  };
}

// ── Liste ────────────────────────────────────────────────────────────────────
orderSeriesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = db.prepare('SELECT * FROM order_series ORDER BY created_at DESC').all();
    res.json({ series: rows.map(mapSeries) });
  })
);

orderSeriesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT * FROM order_series WHERE id = ?').get(Number(req.params.id));
    if (!row) throw notFound('Serie nicht gefunden');
    res.json({ series: mapSeries(row) });
  })
);

// ── Anlegen: erzeugt sofort alle Einzeltermine als Aufträge ─────────────────
orderSeriesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = validate(seriesSchema, req.body);

    // Kein Enddatum angegeben = "läuft bis auf Weiteres". Wir erzeugen dafür
    // konkret Termine für ein Jahr im Voraus; die Serie lässt sich danach
    // jederzeit über "Weitere Termine anlegen" (POST .../extend) fortsetzen.
    const openEnded = !data.endDate;
    const effectiveEndDate = data.endDate || addDays(data.startDate, OPEN_ENDED_HORIZON_DAYS);

    const dates = generateDates({ ...data, endDate: effectiveEndDate });

    if (dates.length === 0) {
      throw badRequest('Im gewählten Zeitraum liegt kein passender Termin.');
    }

    const assigneeIdList = [...new Set(data.assigneeIds ?? [])];

    const result = db.transaction(() => {
      const seriesInfo = db
        .prepare(
          `INSERT INTO order_series
             (customer_id, customer_name, address, contact_phone, order_type, subtype, notes,
              interval_type, weekdays, start_time, end_time, start_date, end_date, open_ended,
              assignee_ids, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          data.customerId ?? null,
          data.customerName,
          data.address,
          data.contactPhone ?? null,
          data.orderType,
          data.subtype ?? null,
          data.notes ?? null,
          data.intervalType,
          data.intervalType === 'MONTHLY' ? null : [...new Set(data.weekdays)].sort().join(','),
          data.startTime ?? null,
          data.endTime ?? null,
          data.startDate,
          effectiveEndDate,
          openEnded ? 1 : 0,
          assigneeIdList.length ? assigneeIdList.join(',') : null,
          req.user.id
        );
      const seriesId = Number(seriesInfo.lastInsertRowid);

      const insertOrder = db.prepare(
        `INSERT INTO orders
           (customer_name, address, contact_phone, customer_id, series_id, order_type, subtype, status,
            scheduled_date, start_time, end_time, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'OFFEN', ?, ?, ?, ?, ?)`
      );
      const insertHistory = db.prepare(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by)
         VALUES (?, NULL, 'OFFEN', ?)`
      );
      const insertAssignment = db.prepare(
        'INSERT INTO order_assignments (order_id, user_id) VALUES (?, ?)'
      );

      const createdOrderIds = [];
      for (const date of dates) {
        const info = insertOrder.run(
          data.customerName,
          data.address,
          data.contactPhone ?? null,
          data.customerId ?? null,
          seriesId,
          data.orderType,
          data.subtype ?? null,
          date,
          data.startTime ?? null,
          data.endTime ?? null,
          data.notes ?? null,
          req.user.id
        );
        const orderId = Number(info.lastInsertRowid);
        insertHistory.run(orderId, req.user.id);
        for (const userId of new Set(data.assigneeIds ?? [])) {
          insertAssignment.run(orderId, userId);
        }
        syncShiftsForOrder(orderId, req.user.id);
        createdOrderIds.push(orderId);
      }

      return { seriesId, createdOrderIds };
    })();

    const series = db.prepare('SELECT * FROM order_series WHERE id = ?').get(result.seriesId);
    res.status(201).json({ series: mapSeries(series), createdOrders: result.createdOrderIds.length });
  })
);

// ── Verlängern: weitere Termine für eine offene Serie erzeugen ─────────────
// Nur für Serien ohne festes Enddatum gedacht. Erzeugt Termine für ein
// weiteres Jahr ab dem aktuellen Terminhorizont, im selben Rhythmus wie bei
// der Anlage, inklusive der ursprünglich zugewiesenen Mitarbeiter.
orderSeriesRouter.post(
  '/:id/extend',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const series = db.prepare('SELECT * FROM order_series WHERE id = ?').get(id);
    if (!series) throw notFound('Serie nicht gefunden');
    if (!series.open_ended) {
      throw badRequest('Nur Serien ohne festes Enddatum lassen sich auf diese Weise verlängern.');
    }

    const newHorizon = addDays(series.end_date, OPEN_ENDED_HORIZON_DAYS);
    const dates = generateDates({
      intervalType: series.interval_type,
      weekdays: series.weekdays ? series.weekdays.split(',').map(Number) : [],
      startDate: series.start_date,
      endDate: newHorizon,
      from: addDays(series.end_date, 1),
    });

    if (dates.length === 0) {
      // Kein neuer Termin im erweiterten Zeitraum (z. B. bei sehr seltenem
      // Rhythmus) – Horizont trotzdem fortschreiben, damit der nächste
      // Verlängerungs-Versuch weiterkommt, statt hier hängen zu bleiben.
      db.prepare('UPDATE order_series SET end_date = ? WHERE id = ?').run(newHorizon, id);
      return res.json({ series: mapSeries({ ...series, end_date: newHorizon }), createdOrders: 0 });
    }

    const assigneeIdList = series.assignee_ids
      ? series.assignee_ids.split(',').map(Number)
      : [];

    const result = db.transaction(() => {
      const insertOrder = db.prepare(
        `INSERT INTO orders
           (customer_name, address, contact_phone, customer_id, series_id, order_type, subtype, status,
            scheduled_date, start_time, end_time, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'OFFEN', ?, ?, ?, ?, ?)`
      );
      const insertHistory = db.prepare(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by)
         VALUES (?, NULL, 'OFFEN', ?)`
      );
      const insertAssignment = db.prepare(
        'INSERT INTO order_assignments (order_id, user_id) VALUES (?, ?)'
      );

      const createdOrderIds = [];
      for (const date of dates) {
        const info = insertOrder.run(
          series.customer_name,
          series.address,
          series.contact_phone,
          series.customer_id,
          id,
          series.order_type,
          series.subtype,
          date,
          series.start_time,
          series.end_time,
          series.notes,
          req.user.id
        );
        const orderId = Number(info.lastInsertRowid);
        insertHistory.run(orderId, req.user.id);
        for (const userId of assigneeIdList) {
          insertAssignment.run(orderId, userId);
        }
        syncShiftsForOrder(orderId, req.user.id);
        createdOrderIds.push(orderId);
      }

      db.prepare('UPDATE order_series SET end_date = ? WHERE id = ?').run(newHorizon, id);

      return createdOrderIds;
    })();

    const updated = db.prepare('SELECT * FROM order_series WHERE id = ?').get(id);
    res.json({ series: mapSeries(updated), createdOrders: result.length });
  })
);

// ── Beenden: storniert alle noch offenen zukünftigen Termine ────────────────
// ── Vertretung: Mitarbeiter für einen Zeitraum umbesetzen ───────────────────
// Gedacht für Urlaub/Krankheit: statt jeden einzelnen Termin von Hand
// umzubesetzen, wählt man einen Zeitraum + Ersatz-Mitarbeiter – alle
// betroffenen Termine dieser Serie werden auf einmal umbesetzt. Termine vor
// und nach dem Zeitraum bleiben unangetastet (der ursprüngliche Mitarbeiter
// ist dort also automatisch weiterhin zuständig, ganz ohne Rückumstellung).
const reassignSchema = z
  .object({
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT'),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT'),
    assigneeIds: z.array(z.number().int().positive()).min(1, 'Bitte mindestens einen Mitarbeiter wählen'),
  })
  .refine((data) => data.toDate >= data.fromDate, {
    message: 'Das Enddatum muss nach dem Startdatum liegen',
    path: ['toDate'],
  });

orderSeriesRouter.post(
  '/:id/reassign',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const series = db.prepare('SELECT * FROM order_series WHERE id = ?').get(id);
    if (!series) throw notFound('Serie nicht gefunden');

    const { fromDate, toDate, assigneeIds } = validate(reassignSchema, req.body);

    const affected = db
      .prepare(
        `SELECT id FROM orders
           WHERE series_id = ? AND status != 'STORNIERT'
             AND scheduled_date IS NOT NULL AND scheduled_date BETWEEN ? AND ?`
      )
      .all(id, fromDate, toDate);

    db.transaction(() => {
      const deleteAssignments = db.prepare('DELETE FROM order_assignments WHERE order_id = ?');
      const insertAssignment = db.prepare(
        'INSERT INTO order_assignments (order_id, user_id) VALUES (?, ?)'
      );
      for (const order of affected) {
        deleteAssignments.run(order.id);
        for (const userId of new Set(assigneeIds)) {
          insertAssignment.run(order.id, userId);
        }
        // Dienstplan sofort nachziehen – Vertretung erscheint automatisch bei
        // der Administration und beim neu eingeteilten Mitarbeiter, während
        // sie beim ursprünglichen Mitarbeiter verschwindet.
        syncShiftsForOrder(order.id, req.user.id);
      }
    })();

    res.json({ updated: affected.length });
  })
);

orderSeriesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const series = db.prepare('SELECT * FROM order_series WHERE id = ?').get(id);
    if (!series) throw notFound('Serie nicht gefunden');

    const today = new Date().toISOString().slice(0, 10);

    db.transaction(() => {
      // Nur noch offene, zukünftige Termine stornieren – bereits begonnene
      // oder erledigte Aufträge bleiben unangetastet (echte Arbeitshistorie).
      const affected = db
        .prepare(
          `SELECT id, status FROM orders
             WHERE series_id = ? AND status = 'OFFEN' AND (scheduled_date IS NULL OR scheduled_date >= ?)`
        )
        .all(id, today);

      const updateStatus = db.prepare(
        `UPDATE orders SET status = 'STORNIERT', updated_at = ? WHERE id = ?`
      );
      const insertHistory = db.prepare(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by)
         VALUES (?, ?, 'STORNIERT', ?)`
      );
      for (const order of affected) {
        updateStatus.run(now(), order.id);
        insertHistory.run(order.id, order.status, req.user.id);
        // Storniert -> kein Einsatz mehr an diesem Tag, Dienstplan-Eintrag entfernen.
        syncShiftsForOrder(order.id, req.user.id);
      }

      // Die Serie selbst löschen – bereits erzeugte Aufträge bleiben über
      // ihre eigene ID vollständig erhalten (series_id wird dank
      // "ON DELETE SET NULL" automatisch entkoppelt, siehe schema.sql).
      db.prepare('DELETE FROM order_series WHERE id = ?').run(id);
    })();

    res.json({ ok: true });
  })
);
