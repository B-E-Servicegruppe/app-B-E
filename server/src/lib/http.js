/**
 * Kleine Helfer für einheitliche HTTP-Antworten und Fehlerbehandlung.
 */

/** Fehler mit HTTP-Statuscode – wird vom zentralen Error-Handler ausgewertet. */
export class HttpError extends Error {
  /**
   * @param {number} status HTTP-Statuscode (z. B. 403)
   * @param {string} message Für den Benutzer verständliche Meldung (deutsch)
   * @param {unknown} [details] Optionale Zusatzinfos (z. B. Validierungsfehler)
   */
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg = 'Ungültige Anfrage', details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Nicht angemeldet') => new HttpError(401, msg);
export const forbidden = (msg = 'Keine Berechtigung für diesen Bereich') => new HttpError(403, msg);
export const notFound = (msg = 'Nicht gefunden') => new HttpError(404, msg);
export const conflict = (msg = 'Konflikt') => new HttpError(409, msg);

/**
 * Wrapper für asynchrone Route-Handler, damit abgefangene Fehler automatisch
 * an den Express-Error-Handler weitergereicht werden.
 * @param {(req: any, res: any, next: any) => Promise<any>} handler
 */
export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

/**
 * Validiert den Request-Body mit einem Zod-Schema und liefert die geparsten
 * Daten zurück. Bei Fehlern wird ein HTTP 400 mit Feldhinweisen erzeugt.
 * @template T
 * @param {{ safeParse: (v: unknown) => any }} schema
 * @param {unknown} data
 * @returns {T}
 */
export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    throw badRequest('Bitte Eingaben prüfen', details);
  }
  return result.data;
}
