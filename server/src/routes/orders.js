/**
 * Auftragsverwaltung.
 *
 *   GET    /api/orders                       – Liste (mit Filtern & Suche)
 *   GET    /api/orders/:id                   – Detail inkl. Material, Dateien, Historie
 *   POST   /api/orders                       – anlegen                      (nur Admin)
 *   PUT    /api/orders/:id                   – bearbeiten                   (nur Admin)
 *   DELETE /api/orders/:id                   – löschen                      (nur Admin)
 *   POST   /api/orders/:id/duplicate         – duplizieren                  (nur Admin)
 *   PATCH  /api/orders/:id/status            – Status ändern      (Admin oder zugewiesen)
 *   PATCH  /api/orders/:id/materials/:mid    – Material abhaken   (Admin oder zugewiesen)
 *   POST   /api/orders/:id/comments          – Rückmeldung        (Admin oder zugewiesen)
 *   POST   /api/orders/:id/files             – Datei/Foto hochladen(Admin oder zugewiesen)
 *   DELETE /api/orders/:id/files/:fid        – Datei löschen       (Admin oder Hochladender)
 *
 * WICHTIG: Mitarbeiter sehen und bearbeiten ausschließlich Aufträge, denen sie
 * zugewiesen sind. Das wird in jeder einzelnen Route serverseitig geprüft
 * (loadOrderForUser bzw. explizite Filter in der SQL-Abfrage).
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { z } from 'zod';
import { db, now } from '../db/index.js';
import { asyncHandler, badRequest, forbidden, notFound, validate } from '../lib/http.js';
import { isAdmin, isAssignedToOrder, loadOrderForUser, requireAdmin, requireAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { config } from '../config.js';

export const ordersRouter = express.Router();

// Alle Auftrags-Routen setzen eine Anmeldung voraus.
ordersRouter.use(requireAuth);

export const ORDER_TYPES = ['REINIGUNG', 'GARTEN', 'ABRISS', 'WINTERDIENST', 'ENTRUEMPELUNG'];
export const ORDER_STATUSES = ['OFFEN', 'IN_ARBEIT', 'ERLEDIGT', 'STORNIERT'];

// ── Validierungsschemata ─────────────────────────────────────────────────────
const materialSchema = z.object({
  name: z.string().trim().min(1, 'Material braucht eine Bezeichnung'),
  quantity: z.string().trim().max(60).optional().nullable(),
  done: z.boolean().optional(),
});

const orderInputSchema = z.object({
  customerName: z.string().trim().min(1, 'Bitte Kundenname angeben'),
  address: z.string().trim().min(1, 'Bitte Adresse angeben'),
  contactPhone: z.string().trim().max(60).optional().nullable(),
  // Optionaler Verweis auf einen gespeicherten Kunden (siehe routes/customers.js).
  // Name/Adresse/Telefon oben bleiben trotzdem die maßgebliche Momentaufnahme.
  customerId: z.number().int().positive().optional().nullable(),
  orderType: z.enum(ORDER_TYPES, { message: 'Bitte Auftragsart wählen' }),
  // Unterart innerhalb der Auftragsart, z. B. "Grundreinigung". Frei
  // befüllbar, die Vorschlagsliste je Auftragsart kommt aus dem Frontend.
  subtype: z.string().trim().max(120).optional().nullable(),
  status: z.enum(ORDER_STATUSES).optional(),
  scheduledDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT')
    .optional()
    .nullable(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Uhrzeit im Format HH:MM').optional().nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Uhrzeit im Format HH:MM').optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  materials: z.array(materialSchema).optional(),
  assigneeIds: z.array(z.number().int().positive()).optional(),
});

/**
 * Beim Anlegen/Bearbeiten kommen die Daten je nach Formular als JSON oder – wenn
 * gleichzeitig Dateien hochgeladen werden – als multipart/form-data an. Im
 * zweiten Fall sind alle Werte Strings, `materials` und `assigneeIds` werden
 * dann als JSON-String übertragen.
 */
function parseOrderBody(body) {
  const parsed = { ...body };
  for (const key of ['materials', 'assigneeIds']) {
    if (typeof parsed[key] === 'string') {
      try {
        parsed[key] = JSON.parse(parsed[key]);
      } catch {
        throw badRequest(`Feld ${key} konnte nicht gelesen werden`);
      }
    }
  }
  // Leere Strings aus Formularen als "nicht gesetzt" behandeln
  for (const key of ['contactPhone', 'scheduledDate', 'startTime', 'endTime', 'notes', 'subtype']) {
    if (parsed[key] === '') parsed[key] = null;
  }
  // customerId kommt aus multipart/form-data als String an
  if (parsed.customerId === '' || parsed.customerId === null || parsed.customerId === undefined) {
    parsed.customerId = null;
  } else if (typeof parsed.customerId === 'string') {
    parsed.customerId = Number(parsed.customerId);
  }
  return parsed;
}

// ── Hilfsfunktionen zum Zusammenbauen der Antwort ────────────────────────────

/** Wandelt eine Auftragszeile in die vom Frontend erwartete Struktur um. */
function mapOrder(row) {
  return {
    id: row.id,
    customerName: row.customer_name,
    address: row.address,
    contactPhone: row.contact_phone,
    customerId: row.customer_id ?? null,
    seriesId: row.series_id ?? null,
    orderType: row.order_type,
    subtype: row.subtype ?? null,
    status: row.status,
    scheduledDate: row.scheduled_date,
    startTime: row.start_time,
    endTime: row.end_time,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Lädt die zugewiesenen Mitarbeiter eines Auftrags. */
function getAssignees(orderId) {
  return db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.active
         FROM order_assignments a
         JOIN users u ON u.id = a.user_id
        WHERE a.order_id = ?
        ORDER BY u.name COLLATE NOCASE`
    )
    .all(orderId)
    .map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, active: Boolean(u.active) }));
}

function getMaterials(orderId) {
  return db
    .prepare('SELECT * FROM order_materials WHERE order_id = ? ORDER BY position, id')
    .all(orderId)
    .map((m) => ({ id: m.id, name: m.name, quantity: m.quantity, done: Boolean(m.done) }));
}

function getFiles(orderId) {
  return db
    .prepare(
      `SELECT f.*, u.name AS uploader_name
         FROM order_files f
    LEFT JOIN users u ON u.id = f.uploaded_by
        WHERE f.order_id = ?
        ORDER BY f.created_at`
    )
    .all(orderId)
    .map((f) => ({
      id: f.id,
      kind: f.kind,
      originalName: f.original_name,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
      uploadedBy: f.uploader_name,
      uploadedById: f.uploaded_by,
      createdAt: f.created_at,
      /** Download-URL – der Zugriff wird beim Abruf erneut geprüft. */
      url: `/api/files/${f.id}`,
    }));
}

function getHistory(orderId) {
  return db
    .prepare(
      `SELECT h.*, u.name AS user_name
         FROM order_status_history h
    LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.order_id = ?
        ORDER BY h.changed_at DESC, h.id DESC`
    )
    .all(orderId)
    .map((h) => ({
      id: h.id,
      fromStatus: h.from_status,
      toStatus: h.to_status,
      changedBy: h.user_name,
      changedAt: h.changed_at,
    }));
}

function getComments(orderId) {
  return db
    .prepare(
      `SELECT c.*, u.name AS user_name, u.role AS user_role
         FROM order_comments c
    LEFT JOIN users u ON u.id = c.user_id
        WHERE c.order_id = ?
        ORDER BY c.created_at`
    )
    .all(orderId)
    .map((c) => ({
      id: c.id,
      body: c.body,
      author: c.user_name,
      authorRole: c.user_role,
      createdAt: c.created_at,
    }));
}

/** Schreibt Material- und Zuweisungslisten neu (einfacher als Einzel-Diffs). */
function replaceMaterials(orderId, materials = []) {
  db.prepare('DELETE FROM order_materials WHERE order_id = ?').run(orderId);
  const insert = db.prepare(
    'INSERT INTO order_materials (order_id, name, quantity, done, position) VALUES (?, ?, ?, ?, ?)'
  );
  materials.forEach((m, index) => {
    insert.run(orderId, m.name.trim(), m.quantity?.trim() || null, m.done ? 1 : 0, index);
  });
}

function replaceAssignees(orderId, assigneeIds = []) {
  db.prepare('DELETE FROM order_assignments WHERE order_id = ?').run(orderId);
  const insert = db.prepare('INSERT INTO order_assignments (order_id, user_id) VALUES (?, ?)');
  const exists = db.prepare("SELECT 1 AS ok FROM users WHERE id = ? AND role = 'EMPLOYEE'");
  for (const userId of new Set(assigneeIds)) {
    // Nur bestehende Mitarbeiterkonten dürfen zugewiesen werden
    if (exists.get(userId)) insert.run(orderId, userId);
  }
}

/** Speichert Upload-Metadaten zu einem Auftrag. */
function saveFiles(orderId, files, userId, kind) {
  const insert = db.prepare(
    `INSERT INTO order_files (order_id, uploaded_by, kind, original_name, stored_name, mime_type, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const file of files || []) {
    insert.run(orderId, userId, kind, file.originalname, file.filename, file.mimetype, file.size);
  }
}

// ── Liste ────────────────────────────────────────────────────────────────────
/**
 * Filter (alle optional, per Query-String):
 *   status=OFFEN|IN_ARBEIT|ERLEDIGT|STORNIERT
 *   type=REINIGUNG|…
 *   employeeId=<id>     (nur für Admins wirksam)
 *   from=YYYY-MM-DD & to=YYYY-MM-DD
 *   scope=today|week    (Kurzform für Datumsbereich; für "Meine Aufträge"-Tabs)
 *   q=<Suchtext>        (Kundenname, Adresse, Notizen, Auftragsnummer)
 */
ordersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];

    // ---- Rechteprüfung: Mitarbeiter bekommen zwingend nur eigene Aufträge ----
    if (!isAdmin(req.user)) {
      where.push('o.id IN (SELECT order_id FROM order_assignments WHERE user_id = ?)');
      params.push(req.user.id);
    } else if (req.query.employeeId) {
      where.push('o.id IN (SELECT order_id FROM order_assignments WHERE user_id = ?)');
      params.push(Number(req.query.employeeId));
    }

    if (req.query.status && ORDER_STATUSES.includes(req.query.status)) {
      where.push('o.status = ?');
      params.push(req.query.status);
    }
    if (req.query.type && ORDER_TYPES.includes(req.query.type)) {
      where.push('o.order_type = ?');
      params.push(req.query.type);
    }

    // Zeitraum – entweder explizit (from/to) oder als Kurzform (scope)
    const { from, to } = resolveDateRange(req.query);
    if (from) {
      where.push('o.scheduled_date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('o.scheduled_date <= ?');
      params.push(to);
    }

    if (req.query.q) {
      const term = `%${String(req.query.q).trim()}%`;
      where.push(
        '(o.customer_name LIKE ? OR o.address LIKE ? OR o.notes LIKE ? OR CAST(o.id AS TEXT) = ?)'
      );
      params.push(term, term, term, String(req.query.q).trim());
    }

    const rows = db
      .prepare(
        `SELECT o.* FROM orders o
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY
           CASE WHEN o.scheduled_date IS NULL THEN 1 ELSE 0 END,
           o.scheduled_date ASC,
           o.start_time ASC,
           o.id DESC`
      )
      .all(...params);

    res.json({
      orders: rows.map((row) => ({
        ...mapOrder(row),
        assignees: getAssignees(row.id),
        materialCount: db
          .prepare('SELECT COUNT(*) AS c FROM order_materials WHERE order_id = ?')
          .get(row.id).c,
        fileCount: db.prepare('SELECT COUNT(*) AS c FROM order_files WHERE order_id = ?').get(row.id)
          .c,
      })),
    });
  })
);

/**
 * Übersetzt scope=today|week bzw. from/to in einen Datumsbereich.
 * Die Woche beginnt am Montag (deutsche Konvention).
 */
function resolveDateRange(query) {
  if (query.scope === 'today') {
    const today = query.today || localDateString(new Date());
    return { from: today, to: today };
  }
  if (query.scope === 'week') {
    const base = query.today ? new Date(`${query.today}T12:00:00`) : new Date();
    const day = (base.getDay() + 6) % 7; // Montag = 0
    const monday = new Date(base);
    monday.setDate(base.getDate() - day);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: localDateString(monday), to: localDateString(sunday) };
  }
  return {
    from: /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : null,
    to: /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : null,
  };
}

/** Datum als 'YYYY-MM-DD' in lokaler Zeit (nicht UTC – sonst Verschiebung). */
function localDateString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ── Dashboard-Kennzahlen ─────────────────────────────────────────────────────
/** Anzahl offen / in Arbeit / erledigt – für Mitarbeiter nur eigene Aufträge. */
ordersRouter.get(
  '/stats/summary',
  asyncHandler(async (req, res) => {
    const scopeSql = isAdmin(req.user)
      ? ''
      : 'WHERE id IN (SELECT order_id FROM order_assignments WHERE user_id = ?)';
    const params = isAdmin(req.user) ? [] : [req.user.id];

    const rows = db
      .prepare(`SELECT status, COUNT(*) AS count FROM orders ${scopeSql} GROUP BY status`)
      .all(...params);

    const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
    for (const row of rows) byStatus[row.status] = row.count;

    const today = localDateString(new Date());
    const todayCount = db
      .prepare(
        `SELECT COUNT(*) AS c FROM orders
          WHERE scheduled_date = ?
            AND status != 'STORNIERT'
            ${isAdmin(req.user) ? '' : 'AND id IN (SELECT order_id FROM order_assignments WHERE user_id = ?)'}`
      )
      .get(...[today, ...params]).c;

    res.json({ byStatus, total: rows.reduce((sum, r) => sum + r.count, 0), today: todayCount });
  })
);

// ── Detail ───────────────────────────────────────────────────────────────────
ordersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(Number(req.params.id), req.user);
    res.json({
      order: {
        ...mapOrder(order),
        assignees: getAssignees(order.id),
        materials: getMaterials(order.id),
        files: getFiles(order.id),
        history: getHistory(order.id),
        comments: getComments(order.id),
      },
    });
  })
);

// ── Anlegen (nur Admin) ──────────────────────────────────────────────────────
ordersRouter.post(
  '/',
  requireAdmin,
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    const data = validate(orderInputSchema, parseOrderBody(req.body));

    const orderId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO orders
             (customer_name, address, contact_phone, customer_id, order_type, subtype, status,
              scheduled_date, start_time, end_time, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          data.customerName,
          data.address,
          data.contactPhone ?? null,
          data.customerId ?? null,
          data.orderType,
          data.subtype ?? null,
          data.status ?? 'OFFEN',
          data.scheduledDate ?? null,
          data.startTime ?? null,
          data.endTime ?? null,
          data.notes ?? null,
          req.user.id
        );
      const id = Number(info.lastInsertRowid);

      replaceMaterials(id, data.materials);
      replaceAssignees(id, data.assigneeIds);
      saveFiles(id, req.files, req.user.id, 'ATTACHMENT');

      // Anlage als ersten Eintrag der Statushistorie festhalten
      db.prepare(
        'INSERT INTO order_status_history (order_id, from_status, to_status, changed_by) VALUES (?, NULL, ?, ?)'
      ).run(id, data.status ?? 'OFFEN', req.user.id);

      return id;
    })();

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    res.status(201).json({ order: { ...mapOrder(order), assignees: getAssignees(orderId) } });
  })
);

// ── Bearbeiten (nur Admin) ───────────────────────────────────────────────────
ordersRouter.put(
  '/:id',
  requireAdmin,
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!existing) throw notFound('Auftrag nicht gefunden');

    const data = validate(orderInputSchema, parseOrderBody(req.body));
    const newStatus = data.status ?? existing.status;

    db.transaction(() => {
      db.prepare(
        `UPDATE orders
            SET customer_name = ?, address = ?, contact_phone = ?, customer_id = ?, order_type = ?, subtype = ?, status = ?,
                scheduled_date = ?, start_time = ?, end_time = ?, notes = ?, updated_at = ?
          WHERE id = ?`
      ).run(
        data.customerName,
        data.address,
        data.contactPhone ?? null,
        data.customerId ?? null,
        data.orderType,
        data.subtype ?? null,
        newStatus,
        data.scheduledDate ?? null,
        data.startTime ?? null,
        data.endTime ?? null,
        data.notes ?? null,
        now(),
        id
      );

      if (data.materials) replaceMaterials(id, data.materials);
      if (data.assigneeIds) replaceAssignees(id, data.assigneeIds);
      saveFiles(id, req.files, req.user.id, 'ATTACHMENT');

      if (newStatus !== existing.status) {
        db.prepare(
          'INSERT INTO order_status_history (order_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?)'
        ).run(id, existing.status, newStatus, req.user.id);
      }
    })();

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    res.json({ order: { ...mapOrder(order), assignees: getAssignees(id) } });
  })
);

// ── Löschen (nur Admin) ──────────────────────────────────────────────────────
ordersRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) throw notFound('Auftrag nicht gefunden');

    // Zugehörige Dateien auch von der Platte entfernen
    const files = db.prepare('SELECT stored_name FROM order_files WHERE order_id = ?').all(id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(id); // Rest per ON DELETE CASCADE
    for (const file of files) {
      fs.rmSync(path.join(config.uploadDir, file.stored_name), { force: true });
    }

    res.json({ ok: true });
  })
);

// ── Duplizieren (nur Admin) ──────────────────────────────────────────────────
/** Kopiert Stammdaten, Material und Zuweisungen – ohne Historie und Dateien. */
ordersRouter.post(
  '/:id/duplicate',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const source = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!source) throw notFound('Auftrag nicht gefunden');

    const newId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO orders
             (customer_name, address, contact_phone, customer_id, order_type, subtype, status,
              scheduled_date, start_time, end_time, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'OFFEN', ?, ?, ?, ?, ?)`
        )
        .run(
          source.customer_name,
          source.address,
          source.contact_phone,
          source.customer_id,
          source.order_type,
          source.subtype,
          source.scheduled_date,
          source.start_time,
          source.end_time,
          source.notes,
          req.user.id
        );
      const copyId = Number(info.lastInsertRowid);

      db.prepare(
        `INSERT INTO order_materials (order_id, name, quantity, done, position)
         SELECT ?, name, quantity, 0, position FROM order_materials WHERE order_id = ?`
      ).run(copyId, id);

      db.prepare(
        `INSERT INTO order_assignments (order_id, user_id)
         SELECT ?, user_id FROM order_assignments WHERE order_id = ?`
      ).run(copyId, id);

      db.prepare(
        "INSERT INTO order_status_history (order_id, from_status, to_status, changed_by) VALUES (?, NULL, 'OFFEN', ?)"
      ).run(copyId, req.user.id);

      return copyId;
    })();

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(newId);
    res.status(201).json({ order: { ...mapOrder(order), assignees: getAssignees(newId) } });
  })
);

// ── Status ändern (Admin oder zugewiesener Mitarbeiter) ──────────────────────
const statusSchema = z.object({ status: z.enum(ORDER_STATUSES) });

ordersRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(Number(req.params.id), req.user);
    const { status } = validate(statusSchema, req.body);

    // Mitarbeiter dürfen nicht stornieren – das bleibt der Administration vorbehalten.
    if (!isAdmin(req.user) && status === 'STORNIERT') {
      throw forbidden('Stornieren ist nur der Administration möglich');
    }

    if (status !== order.status) {
      db.transaction(() => {
        db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(
          status,
          now(),
          order.id
        );
        db.prepare(
          'INSERT INTO order_status_history (order_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?)'
        ).run(order.id, order.status, status, req.user.id);
      })();
    }

    res.json({ status, history: getHistory(order.id) });
  })
);

// ── Material abhaken (Admin oder zugewiesener Mitarbeiter) ───────────────────
ordersRouter.patch(
  '/:id/materials/:materialId',
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(Number(req.params.id), req.user);
    const materialId = Number(req.params.materialId);
    const done = validate(z.object({ done: z.boolean() }), req.body).done;

    const info = db
      .prepare('UPDATE order_materials SET done = ? WHERE id = ? AND order_id = ?')
      .run(done ? 1 : 0, materialId, order.id);
    if (info.changes === 0) throw notFound('Materialposition nicht gefunden');

    res.json({ materials: getMaterials(order.id) });
  })
);

// ── Rückmeldung/Kommentar (Admin oder zugewiesener Mitarbeiter) ──────────────
ordersRouter.post(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(Number(req.params.id), req.user);
    const { body } = validate(
      z.object({ body: z.string().trim().min(1, 'Bitte Text eingeben').max(2000) }),
      req.body
    );

    db.prepare('INSERT INTO order_comments (order_id, user_id, body) VALUES (?, ?, ?)').run(
      order.id,
      req.user.id,
      body
    );

    res.status(201).json({ comments: getComments(order.id) });
  })
);

// ── Dateien hochladen ────────────────────────────────────────────────────────
/**
 * Admins laden Anhänge hoch (Angebot, Grundriss, Referenzfotos),
 * zugewiesene Mitarbeiter Abschluss-Fotos als Nachweis.
 */
ordersRouter.post(
  '/:id/files',
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(Number(req.params.id), req.user);
    if (!req.files?.length) throw badRequest('Keine Datei ausgewählt');

    const kind = isAdmin(req.user)
      ? req.body.kind === 'PROOF_PHOTO'
        ? 'PROOF_PHOTO'
        : 'ATTACHMENT'
      : 'PROOF_PHOTO';

    saveFiles(order.id, req.files, req.user.id, kind);
    res.status(201).json({ files: getFiles(order.id) });
  })
);

// ── Datei löschen ────────────────────────────────────────────────────────────
ordersRouter.delete(
  '/:id/files/:fileId',
  asyncHandler(async (req, res) => {
    const order = loadOrderForUser(Number(req.params.id), req.user);
    const file = db
      .prepare('SELECT * FROM order_files WHERE id = ? AND order_id = ?')
      .get(Number(req.params.fileId), order.id);
    if (!file) throw notFound('Datei nicht gefunden');

    // Mitarbeiter dürfen nur eigene Uploads wieder entfernen
    if (!isAdmin(req.user) && file.uploaded_by !== req.user.id) {
      throw forbidden('Nur selbst hochgeladene Dateien können gelöscht werden');
    }

    db.prepare('DELETE FROM order_files WHERE id = ?').run(file.id);
    fs.rmSync(path.join(config.uploadDir, file.stored_name), { force: true });

    res.json({ files: getFiles(order.id) });
  })
);

// Export für andere Module (z. B. Dienstplan) – prüft Zuweisung
export { isAssignedToOrder, mapOrder };
