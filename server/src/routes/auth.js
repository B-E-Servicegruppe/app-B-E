/**
 * Routen rund um die Anmeldung.
 *
 *   POST /api/auth/login            – Anmeldung mit E-Mail + Passwort
 *   GET  /api/auth/me               – aktuell angemeldeter Benutzer
 *   POST /api/auth/change-password  – eigenes Passwort ändern
 *   POST /api/auth/forgot-password  – Reset-Link anfordern
 *   POST /api/auth/reset-password   – neues Passwort per Token setzen
 *
 * Eine Selbstregistrierung gibt es bewusst nicht – Konten legt nur ein Admin an.
 */
import express from 'express';
import { z } from 'zod';
import { db, now } from '../db/index.js';
import {
  createAccessToken,
  createResetToken,
  hashPassword,
  hashResetToken,
  verifyPassword,
} from '../lib/security.js';
import { asyncHandler, badRequest, unauthorized, validate } from '../lib/http.js';
import { passwordResetMail, sendMail } from '../lib/mailer.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

export const authRouter = express.Router();

/** Mindestanforderung an neue Passwörter. */
const passwordSchema = z.string().min(8, 'Das Passwort muss mindestens 8 Zeichen lang sein');

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Bitte E-Mail oder Benutzername angeben'),
  password: z.string().min(1, 'Bitte Passwort eingeben'),
});

/**
 * Formt einen Datenbank-Benutzer in die Form, die das Frontend erhält.
 * Der Passwort-Hash wird dabei niemals mit ausgeliefert.
 */
export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone ?? null,
    privateEmail: user.private_email ?? null,
    active: Boolean(user.active),
    mustChangePassword: Boolean(user.must_change_password),
  };
}

// ── Anmeldung ────────────────────────────────────────────────────────────────
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = validate(loginSchema, req.body);

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    // Einheitliche Fehlermeldung: Es darf nicht erkennbar sein, ob eine
    // E-Mail-Adresse im System existiert.
    if (!user) throw unauthorized('E-Mail oder Passwort ist falsch');

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) throw unauthorized('E-Mail oder Passwort ist falsch');

    if (!user.active) {
      throw unauthorized('Dieses Konto wurde deaktiviert. Bitte an die Administration wenden.');
    }

    res.json({ token: createAccessToken(user), user: publicUser(user) });
  })
);

// ── Angemeldeten Benutzer abfragen ───────────────────────────────────────────
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(user) });
  })
);

// ── Eigenes Passwort ändern ──────────────────────────────────────────────────
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Bitte aktuelles Passwort eingeben'),
  newPassword: passwordSchema,
});

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = validate(changePasswordSchema, req.body);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const ok = await verifyPassword(currentPassword, user.password_hash);
    if (!ok) throw badRequest('Das aktuelle Passwort ist falsch');

    db.prepare(
      `UPDATE users
          SET password_hash = ?, must_change_password = 0, updated_at = ?
        WHERE id = ?`
    ).run(await hashPassword(newPassword), now(), user.id);

    res.json({ ok: true });
  })
);

// ── Private E-Mail hinterlegen/ändern ────────────────────────────────────────
const privateEmailSchema = z.object({
  // Leerer String = private Mail wieder entfernen.
  privateEmail: z.union([z.string().trim().email('Bitte gültige E-Mail-Adresse angeben'), z.literal('')]),
});

authRouter.put(
  '/private-email',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { privateEmail } = validate(privateEmailSchema, req.body);

    db.prepare('UPDATE users SET private_email = ?, updated_at = ? WHERE id = ?').run(
      privateEmail || null,
      now(),
      req.user.id
    );

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(user) });
  })
);

// ── Passwort vergessen: Link anfordern ───────────────────────────────────────
const forgotSchema = z.object({ email: z.string().trim().min(1) });

authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { email } = validate(forgotSchema, req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    // Antwort ist immer identisch – auch wenn es das Konto nicht gibt.
    const response = {
      ok: true,
      message: 'Falls ein Konto existiert, wurde ein Link zum Zurücksetzen verschickt.',
    };

    if (!user || !user.active) return res.json(response);

    const { token, tokenHash } = createResetToken();
    const expiresAt = new Date(
      Date.now() + config.passwordResetTtlMinutes * 60 * 1000
    ).toISOString();

    db.prepare(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
    ).run(user.id, tokenHash, expiresAt);

    const resetUrl = `${config.appBaseUrl}/passwort-neu?token=${token}`;
    // Bevorzugt an die private Mail (unabhängig von der Firmenmail erreichbar).
    // Fallback auf die Login-Adresse, falls noch keine private Mail hinterlegt ist.
    const targetEmail = user.private_email || user.email;
    await sendMail(passwordResetMail({ ...user, email: targetEmail }, resetUrl));

    // Im Testbetrieb (kein Mailversand) wird der Link mitgeliefert, damit die
    // Funktion ohne Mailserver ausprobiert werden kann.
    if (!config.isProduction) response.devResetUrl = resetUrl;

    return res.json(response);
  })
);

// ── Passwort vergessen: neues Passwort setzen ────────────────────────────────
const resetSchema = z.object({
  token: z.string().min(1, 'Ungültiger Link'),
  newPassword: passwordSchema,
});

authRouter.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const { token, newPassword } = validate(resetSchema, req.body);

    const row = db
      .prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ?')
      .get(hashResetToken(token));

    if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
      throw badRequest('Der Link ist ungültig oder abgelaufen. Bitte neu anfordern.');
    }

    const hash = await hashPassword(newPassword);
    db.transaction(() => {
      db.prepare(
        `UPDATE users
            SET password_hash = ?, must_change_password = 0, updated_at = ?
          WHERE id = ?`
      ).run(hash, now(), row.user_id);
      // Token verbrauchen und alle weiteren offenen Tokens des Benutzers entwerten
      db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
        .run(now(), row.user_id);
    })();

    res.json({ ok: true });
  })
);
