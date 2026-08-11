/**
 * Authentifizierung und Rechteprüfung – das Herzstück der Datentrennung.
 *
 * GRUNDSATZ: Das Frontend blendet Funktionen nur der Übersichtlichkeit halber
 * aus. Verbindlich ist ausschließlich die Prüfung hier im Backend. Ein
 * Mitarbeiter kommt daher auch über direkte API-Aufrufe (curl, Browser-URL)
 * nicht an fremde Aufträge oder Dienstpläne.
 */
import { db } from '../db/index.js';
import { verifyAccessToken } from '../lib/security.js';
import { forbidden, notFound, unauthorized } from '../lib/http.js';

/**
 * Liest das Bearer-Token, lädt den Benutzer frisch aus der Datenbank und hängt
 * ihn als req.user an. Der Benutzer wird bei JEDER Anfrage neu geladen, damit
 * eine Deaktivierung oder ein Rollenwechsel sofort greift (und nicht erst,
 * wenn das Token abläuft).
 */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return next(unauthorized());

  const payload = verifyAccessToken(token);
  if (!payload) return next(unauthorized('Sitzung abgelaufen – bitte neu anmelden'));

  const user = db
    .prepare('SELECT id, name, email, role, phone, active FROM users WHERE id = ?')
    .get(Number(payload.sub));

  if (!user) return next(unauthorized('Benutzerkonto existiert nicht mehr'));
  if (!user.active) return next(forbidden('Dieses Konto ist deaktiviert'));

  req.user = user;
  return next();
}

/** Lässt nur Administratoren durch. */
export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'ADMIN') {
    return next(forbidden('Dieser Bereich ist der Administration vorbehalten'));
  }
  return next();
}

/** @returns {boolean} */
export function isAdmin(user) {
  return user?.role === 'ADMIN';
}

/**
 * Prüft, ob ein Benutzer einem Auftrag zugewiesen ist.
 * @param {number} orderId
 * @param {number} userId
 * @returns {boolean}
 */
export function isAssignedToOrder(orderId, userId) {
  const row = db
    .prepare('SELECT 1 AS ok FROM order_assignments WHERE order_id = ? AND user_id = ?')
    .get(orderId, userId);
  return Boolean(row);
}

/**
 * Lädt einen Auftrag und stellt sicher, dass der angemeldete Benutzer ihn sehen
 * darf. Admins dürfen alles, Mitarbeiter nur zugewiesene Aufträge.
 *
 * Bewusst wird für "nicht zugewiesen" derselbe 404 geliefert wie für "existiert
 * nicht" – so lässt sich über die API nicht herausfinden, welche Auftragsnummern
 * es überhaupt gibt.
 *
 * @param {number} orderId
 * @param {{ id: number, role: string }} user
 * @throws {HttpError} 404 wenn nicht vorhanden oder nicht zugewiesen
 */
export function loadOrderForUser(orderId, user) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw notFound('Auftrag nicht gefunden');
  if (!isAdmin(user) && !isAssignedToOrder(orderId, user.id)) {
    throw notFound('Auftrag nicht gefunden');
  }
  return order;
}
