/**
 * Kunden-/Objektverwaltung.
 *
 *   GET    /api/customers        – Liste (für alle angemeldeten Benutzer lesbar,
 *                                   damit die Auswahl im Auftragsformular für
 *                                   jeden funktioniert, der Aufträge anlegt)
 *   POST   /api/customers        – anlegen                       (nur Admin)
 *   PUT    /api/customers/:id    – bearbeiten                    (nur Admin)
 *   DELETE /api/customers/:id    – löschen                       (nur Admin)
 *
 * Ein Kunde ist reine Komfortfunktion: Beim Anlegen eines Auftrags können
 * Name/Adresse/Telefon automatisch übernommen werden, statt sie erneut
 * einzutippen. Bereits angelegte Aufträge speichern diese Angaben zusätzlich
 * als eigene Momentaufnahme (orders.customer_name/address/contact_phone) –
 * eine spätere Änderung am Kunden wirkt sich also nicht auf alte Aufträge aus.
 */
import express from 'express';
import { z } from 'zod';
import { db, now } from '../db/index.js';
import { asyncHandler, badRequest, notFound, validate } from '../lib/http.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

export const customersRouter = express.Router();

customersRouter.use(requireAuth);

function mapCustomer(row) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    contactPhone: row.contact_phone,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Kennzahl für die Übersicht: wie oft wurde dieser Kunde schon beauftragt?
    orderCount: db
      .prepare('SELECT COUNT(*) AS c FROM orders WHERE customer_id = ?')
      .get(row.id).c,
  };
}

// ── Liste (für alle angemeldeten Benutzer, z. B. für die Auswahl im Formular) ─
customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const search = (req.query.q || '').toString().trim();
    const rows = search
      ? db
          .prepare(
            `SELECT * FROM customers
              WHERE name LIKE ? OR address LIKE ?
              ORDER BY name COLLATE NOCASE`
          )
          .all(`%${search}%`, `%${search}%`)
      : db.prepare('SELECT * FROM customers ORDER BY name COLLATE NOCASE').all();

    res.json({ customers: rows.map(mapCustomer) });
  })
);

customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(req.params.id));
    if (!row) throw notFound('Kunde nicht gefunden');
    res.json({ customer: mapCustomer(row) });
  })
);

// Ab hier: nur Administration
customersRouter.use(requireAdmin);

const customerSchema = z.object({
  name: z.string().trim().min(1, 'Bitte Namen angeben'),
  address: z.string().trim().max(400).optional().nullable(),
  contactPhone: z.string().trim().max(60).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

customersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = validate(customerSchema, req.body);
    const info = db
      .prepare(
        'INSERT INTO customers (name, address, contact_phone, notes, created_by) VALUES (?, ?, ?, ?, ?)'
      )
      .run(data.name, data.address || null, data.contactPhone || null, data.notes || null, req.user.id);

    const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ customer: mapCustomer(row) });
  })
);

customersRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 AS ok FROM customers WHERE id = ?').get(id)) {
      throw notFound('Kunde nicht gefunden');
    }
    const data = validate(customerSchema, req.body);

    db.prepare(
      'UPDATE customers SET name = ?, address = ?, contact_phone = ?, notes = ?, updated_at = ? WHERE id = ?'
    ).run(data.name, data.address || null, data.contactPhone || null, data.notes || null, now(), id);

    const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    res.json({ customer: mapCustomer(row) });
  })
);

customersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const used = db.prepare('SELECT 1 AS ok FROM orders WHERE customer_id = ?').get(id);
    if (used) {
      // Bewusst nicht löschbar, solange Aufträge daran hängen – sonst würden
      // dort Verweise ins Leere zeigen. Der Admin soll stattdessen die Daten
      // anpassen oder den Kunden einfach ungenutzt lassen.
      throw badRequest(
        'Dieser Kunde ist noch mit Aufträgen verknüpft und kann daher nicht gelöscht werden.'
      );
    }
    const info = db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    if (info.changes === 0) throw notFound('Kunde nicht gefunden');
    res.json({ ok: true });
  })
);
