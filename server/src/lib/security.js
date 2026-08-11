/**
 * Sicherheitsbausteine: Passwort-Hashing, JWT, Reset-Tokens.
 *
 * Passwörter werden ausschließlich als bcrypt-Hash gespeichert. Es gibt keine
 * Stelle im Code, an der ein Passwort im Klartext in die Datenbank oder in ein
 * Log geschrieben wird.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

/** Kostenfaktor für bcrypt (10 = guter Kompromiss aus Sicherheit und Tempo). */
const BCRYPT_ROUNDS = 10;

/**
 * Erzeugt den bcrypt-Hash eines Passworts.
 * @param {string} plainPassword
 * @returns {Promise<string>}
 */
export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
}

/**
 * Prüft ein Passwort gegen einen gespeicherten Hash.
 * @param {string} plainPassword
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

/**
 * Stellt ein signiertes Zugriffstoken (JWT) für einen Benutzer aus.
 * Im Token stehen nur ID und Rolle – alle Rechteprüfungen erfolgen serverseitig
 * anhand der Datenbank, nicht anhand von Angaben aus dem Token.
 * @param {{ id: number, role: string }} user
 * @returns {string}
 */
export function createAccessToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

/**
 * Verifiziert ein Zugriffstoken.
 * @param {string} token
 * @returns {{ sub: string, role: string } | null} null bei ungültigem/abgelaufenem Token
 */
export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

/**
 * Erzeugt ein Token für den "Passwort vergessen"-Link.
 * Zurückgegeben werden der Klartext (nur für den Link) und der SHA-256-Hash
 * (nur dieser wird gespeichert – ein Datenbankleck erlaubt damit keinen Reset).
 * @returns {{ token: string, tokenHash: string }}
 */
export function createResetToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashResetToken(token) };
}

/**
 * @param {string} token
 * @returns {string} SHA-256-Hash des Tokens
 */
export function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Erzeugt ein zufälliges Initialpasswort für neu angelegte Mitarbeiterkonten.
 * Bewusst gut vorlesbar/tippbar gehalten (keine leicht verwechselbaren Zeichen).
 * @param {number} length
 * @returns {string}
 */
export function generateInitialPassword(length = 10) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
