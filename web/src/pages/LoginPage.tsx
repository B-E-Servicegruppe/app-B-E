/**
 * Anmeldebildschirm mit zentriertem Logo.
 *
 * Es gibt bewusst keine Selbstregistrierung – Konten legt ausschließlich ein
 * Administrator an. Ergänzend: "Passwort vergessen" fordert einen Reset-Link an.
 *
 * Nach der Anmeldung wird rollenabhängig weitergeleitet:
 *   Admin       → Übersicht (Dashboard)
 *   Mitarbeiter → Meine Aufträge
 */
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { ErrorMessage } from '../components/ui';
import { IconLock, IconUser } from '../components/Icons';
import './login.css';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bereits angemeldet? Dann direkt zur passenden Startseite.
  if (user) {
    return <Navigate to={user.role === 'ADMIN' ? '/dashboard' : '/meine-auftraege'} replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const loggedIn = await login(email.trim(), password);
      // Ursprünglich gewünschte Seite (falls die Sitzung abgelaufen war)
      const from = (location.state as { from?: string } | null)?.from;
      const home = loggedIn.role === 'ADMIN' ? '/dashboard' : '/meine-auftraege';
      navigate(from && from !== '/login' ? from : home, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Anmeldung nicht möglich. Bitte später erneut versuchen.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login__card">
        {/* Logo zentriert über dem Formular */}
        <div className="login__logo">
          <img src="/logo.svg" alt="B&E Service Gruppe" />
        </div>

        <h1 className="login__title">Anmelden</h1>
        <p className="login__subtitle">Auftrags- und Dienstplanverwaltung</p>

        <form onSubmit={handleSubmit} noValidate>
          <ErrorMessage error={error} />

          <div className="field">
            <label htmlFor="email">E-Mail / Benutzername</label>
            <div className="input-with-icon">
              <IconUser size={18} />
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@bunde-reinigungsservice.de"
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="password">Passwort</label>
            <div className="input-with-icon">
              <IconLock size={18} />
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
          </div>

          <button type="submit" className="btn btn--block" disabled={busy}>
            {busy ? 'Anmeldung läuft …' : 'Anmelden'}
          </button>
        </form>

        <div className="login__links">
          <Link to="/passwort-vergessen">Passwort vergessen?</Link>
        </div>

        <p className="login__hint">
          Zugänge werden ausschließlich von der Administration angelegt.
        </p>
      </div>

      <p className="login__footer">© {new Date().getFullYear()} B&amp;E Service Gruppe</p>
    </div>
  );
}
