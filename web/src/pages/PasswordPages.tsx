/**
 * "Passwort vergessen" – zwei Schritte:
 *   1. ForgotPasswordPage – Reset-Link anfordern
 *   2. ResetPasswordPage  – neues Passwort über den Link setzen
 *
 * Im Testbetrieb versendet der Server keine echte E-Mail; der Link wird dann
 * direkt angezeigt (und steht zusätzlich in der Server-Konsole).
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, authApi } from '../api/client';
import { ErrorMessage } from '../components/ui';
import './login.css';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await authApi.forgotPassword(email.trim());
      setMessage(response.message);
      setDevLink(response.devResetUrl ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Anfrage fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__logo">
          <img src="/logo.svg" alt="B&E Service Gruppe" />
        </div>

        <h1 className="login__title">Passwort vergessen</h1>
        <p className="login__subtitle">
          E-Mail-Adresse eingeben – wir schicken einen Link zum Zurücksetzen.
        </p>

        <ErrorMessage error={error} />

        {message ? (
          <>
            <div className="alert alert--success">{message}</div>
            {devLink && (
              <div className="alert alert--info" style={{ display: 'block' }}>
                <strong>Testbetrieb:</strong> Es wird noch keine echte E-Mail versendet.
                <br />
                <Link to={new URL(devLink).pathname + new URL(devLink).search}>
                  Hier geht es direkt zum Zurücksetzen
                </Link>
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="email">E-Mail-Adresse</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn--block" disabled={busy}>
              {busy ? 'Wird gesendet …' : 'Link anfordern'}
            </button>
          </form>
        )}

        <div className="login__links">
          <Link to="/login">Zurück zur Anmeldung</Link>
        </div>
      </div>
    </div>
  );
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password !== repeat) {
      setError('Die beiden Passwörter stimmen nicht überein.');
      return;
    }

    setBusy(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Zurücksetzen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__logo">
          <img src="/logo.svg" alt="B&E Service Gruppe" />
        </div>

        <h1 className="login__title">Neues Passwort</h1>
        <p className="login__subtitle">Bitte ein neues Passwort vergeben (mindestens 8 Zeichen).</p>

        <ErrorMessage error={error} />

        {done ? (
          <div className="alert alert--success">
            Passwort gespeichert. Weiterleitung zur Anmeldung …
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="password">Neues Passwort</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="repeat">Passwort wiederholen</label>
              <input
                id="repeat"
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn--block" disabled={busy || !token}>
              {busy ? 'Wird gespeichert …' : 'Passwort speichern'}
            </button>
            {!token && (
              <p className="field__error">
                Der Link ist unvollständig. Bitte einen neuen Link anfordern.
              </p>
            )}
          </form>
        )}

        <div className="login__links">
          <Link to="/login">Zurück zur Anmeldung</Link>
        </div>
      </div>
    </div>
  );
}
