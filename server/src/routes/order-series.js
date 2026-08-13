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
import { ORDER_TYPES } from './orders.js';

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
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Uhrzeit im Format HH:MM').optional().nullable(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Uhrzeit im Format HH:MM').optional().nullable(),
    assigneeIds: z.array(z.number().int().positive()).optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'Das Enddatum muss nach dem Startdatum liegen',
    path: ['endDate'],
  })
  .refine((data) => data.intervalType === 'MONTHLY' || (data.weekdays && data.weekdays.length > 0), {
    message: 'Bitte mindestens einen Wochentag wählen',
    path: ['weekdays'],
  });

/** Erzeugt die Liste der Termin-Daten (YYYY-MM-DD) für eine Serie. */
function generateDates({ intervalType, weekdays, startDate, endDate }) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  if ((end - start) / (1000 * 60 * 60 * 24) > MAX_HORIZON_DAYS) {
    throw badRequest(`Der Zeitraum darf maximal ${MAX_HORIZON_DAYS} Tage umfassen.`);
  }

  const dates = [];

  if (intervalType === 'MONTHLY') {
    const dayOfMonth = start.getUTCDate();
    const cursor = new Date(start);
    while (cursor <= end && dates.length < MAX_OCCURRENCES) {
      dates.push(cursor.toISOString().slice(0, 10));
      // Auf den nächsten Monat springen, dabei Überlauf bei kurzen Monaten
      // (z. B. 31. Januar -> kein 31. Februar) sauber auf den Monatsletzten legen.
      const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
      const daysInNextMonth = new Date(
        Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)
      ).getUTCDate();
      nextMonth.setUTCDate(Math.min(dayOfMonth, daysInNextMonth));
      cursor.setTime(nextMonth.getTime());
    }
    return dates;
  }

  // WEEKLY / BIWEEKLY mit einem oder mehreren Wochentagen: Tag für Tag von
  // startDate bis endDate durchgehen (bei max. 2 Jahren Zeitraum sind das
  // höchstens ~730 Prüfungen – vernachlässigbar) und jeden Tag aufnehmen,
  // dessen Wochentag in der Auswahl ist. Bei BIWEEKLY zusätzlich nur jede
  // zweite Woche, gezählt ab der Woche von startDate, damit alle gewählten
  // Wochentage synchron im gleichen Rhythmus bleiben (kein Auseinanderdriften
  // zwischen z. B. Montag und Donnerstag).
  const weekdaySet = new Set(weekdays);
  // JS: getUTCDay() 0=Sonntag..6=Samstag → auf unser Schema 0=Montag..6=Sonntag umrechnen
  const jsToOurWeekday = (d) => (d.getUTCDay() + 6) % 7;

  // Beginn der Kalenderwoche (Montag) von startDate, als Referenz für BIWEEKLY.
  const startWeekMonday = new Date(start);
  startWeekMonday.setUTCDate(startWeekMonday.getUTCDate() - jsToOurWeekday(startWeekMonday));

  const cursor = new Date(start);
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
    endDate: row.end_date,
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

// ── Anlegen: erzeugt sofort alle Einzeltermine als Aufträge ─────────────────
orderSeriesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = validate(seriesSchema, req.body);
    const dates = generateDates(data);

    if (dates.length === 0) {
      throw badRequest('Im gewählten Zeitraum liegt kein passender Termin.');
    }

    const result = db.transaction(() => {
      const seriesInfo = db
        .prepare(
          `INSERT INTO order_series
             (customer_id, customer_name, address, contact_phone, order_type, subtype, notes,
              interval_type, weekdays, start_time, end_time, start_date, end_date, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          data.endDate,
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
        createdOrderIds.push(orderId);
      }

      return { seriesId, createdOrderIds };
    })();

    const series = db.prepare('SELECT * FROM order_series WHERE id = ?').get(result.seriesId);
    res.status(201).json({ series: mapSeries(series), createdOrders: result.createdOrderIds.length });
  })
);

// ── Beenden: storniert alle noch offenen zukünftigen Termine ────────────────
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
      }

      // Die Serie selbst löschen – bereits erzeugte Aufträge bleiben über
      // ihre eigene ID vollständig erhalten (series_id wird dank
      // "ON DELETE SET NULL" automatisch entkoppelt, siehe schema.sql).
      db.prepare('DELETE FROM order_series WHERE id = ?').run(id);
    })();

    res.json({ ok: true });
  })
);
