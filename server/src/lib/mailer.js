/**
 * E-Mail-Versand.
 *
 * Im Test-/Lokalbetrieb wird keine echte E-Mail verschickt – der Inhalt landet
 * stattdessen in der Server-Konsole (und der Reset-Link zusätzlich in der
 * API-Antwort, siehe routes/auth.js).
 *
 * ERWEITERUNG FÜR DEN ECHTBETRIEB:
 * Hier `nodemailer` (oder einen Anbieter wie Brevo/Postmark) einbinden und in
 * sendMail() versenden. Der restliche Code muss dafür nicht angepasst werden.
 */
import { config } from '../config.js';

/**
 * @param {{ to: string, subject: string, text: string }} message
 * @returns {Promise<void>}
 */
export async function sendMail(message) {
  if (config.isProduction) {
    if (!config.resendApiKey) {
      console.warn('[mail] Kein Versanddienst konfiguriert – E-Mail wurde nicht verschickt.');
      return;
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.mailFrom,
        to: message.to,
        subject: message.subject,
        text: message.text,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('[mail] Versand fehlgeschlagen:', detail);
      throw new Error('E-Mail konnte nicht versendet werden');
    }
    return;
  }
  console.log('\n──────────── E-MAIL (Testmodus, nicht versendet) ────────────');
  console.log(`An:      ${message.to}`);
  console.log(`Betreff: ${message.subject}`);
  console.log(message.text);
  console.log('─────────────────────────────────────────────────────────────\n');
}

/**
 * Baut die "Passwort vergessen"-E-Mail.
 * @param {{ name: string, email: string }} user
 * @param {string} resetUrl
 */
export function passwordResetMail(user, resetUrl) {
  return {
    to: user.email,
    subject: 'B&E Service Gruppe – Passwort zurücksetzen',
    text: [
      `Hallo ${user.name},`,
      '',
      'für dein Konto wurde das Zurücksetzen des Passworts angefordert.',
      'Über den folgenden Link kannst du ein neues Passwort vergeben:',
      '',
      resetUrl,
      '',
      `Der Link ist ${config.passwordResetTtlMinutes} Minuten gültig.`,
      'Falls du das nicht warst, kannst du diese E-Mail ignorieren.',
      '',
      'B&E Service Gruppe',
    ].join('\n'),
  };
}
