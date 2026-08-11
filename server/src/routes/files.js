/**
 * Auslieferung hochgeladener Dateien (PDFs, Fotos).
 *
 *   GET /api/files/:id  – Datei herunterladen/anzeigen
 *
 * Der Zugriff wird bei JEDEM Abruf geprüft: Ein Mitarbeiter kann nur Dateien
 * öffnen, die zu einem ihm zugewiesenen Auftrag gehören. Die Dateien liegen
 * bewusst NICHT in einem öffentlich statisch ausgelieferten Verzeichnis.
 */
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { db } from '../db/index.js';
import { asyncHandler, notFound } from '../lib/http.js';
import { isAdmin, isAssignedToOrder, requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

export const filesRouter = express.Router();

filesRouter.use(requireAuth);

filesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const file = db.prepare('SELECT * FROM order_files WHERE id = ?').get(Number(req.params.id));
    if (!file) throw notFound('Datei nicht gefunden');

    if (!isAdmin(req.user) && !isAssignedToOrder(file.order_id, req.user.id)) {
      // Gleiche Antwort wie "nicht vorhanden" – keine Rückschlüsse auf fremde Daten
      throw notFound('Datei nicht gefunden');
    }

    // stored_name stammt aus dem Server (Zufallsname), zusätzlich abgesichert
    const absolutePath = path.join(config.uploadDir, path.basename(file.stored_name));
    if (!fs.existsSync(absolutePath)) throw notFound('Datei nicht mehr vorhanden');

    res.setHeader('Content-Type', file.mime_type);
    // inline = Bilder/PDFs direkt im Browser anzeigen statt herunterzuladen
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(file.original_name)}"`
    );
    res.sendFile(absolutePath);
  })
);
