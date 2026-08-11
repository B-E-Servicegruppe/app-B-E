/**
 * Zentrale Fehlerbehandlung. Alle Routen werfen HttpError (siehe lib/http.js);
 * hier wird daraus eine einheitliche JSON-Antwort erzeugt.
 */
import multer from 'multer';
import { config } from '../config.js';

/** 404 für unbekannte API-Pfade. */
export function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Endpunkt nicht gefunden' });
}

/* eslint-disable-next-line no-unused-vars -- Express erkennt Error-Handler an 4 Parametern */
export function errorHandler(err, _req, res, _next) {
  // Upload-spezifische Fehler in verständliche Meldungen übersetzen
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `Datei zu groß (maximal ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB)`
        : 'Upload fehlgeschlagen';
    return res.status(400).json({ error: message });
  }

  const status = err.status || 500;
  if (status >= 500) console.error('[server]', err);

  return res.status(status).json({
    error: status >= 500 ? 'Interner Serverfehler' : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}
