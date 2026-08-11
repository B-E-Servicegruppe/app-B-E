/**
 * Datei-Uploads (PDFs und Bilder) via multer.
 *
 * Dateien landen unter server/uploads/ mit einem zufälligen Namen. Der
 * ursprüngliche Dateiname wird nur in der Datenbank gespeichert und beim
 * Download wieder gesetzt – so können manipulierte Dateinamen nicht aus dem
 * Upload-Verzeichnis ausbrechen (Path Traversal).
 */
import crypto from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import { badRequest } from '../lib/http.js';

/** Erlaubte Dateitypen: gängige Bildformate und PDF. */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    // Endung aus dem Originalnamen übernehmen, alles andere verwerfen
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : '';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
  },
});

export const upload = multer({
  storage,
  limits: {
    fileSize: config.maxUploadBytes,
    files: 10, // maximal 10 Dateien pro Anfrage
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(badRequest(`Dateityp nicht erlaubt: ${file.mimetype}. Erlaubt sind Bilder und PDF.`));
      return;
    }
    cb(null, true);
  },
});
