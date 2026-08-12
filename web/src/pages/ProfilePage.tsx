/**
 * Eigenes Konto: Stammdaten ansehen, Passwort ändern, abmelden.
 * Für beide Rollen identisch.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError, authApi } from '../api/client';
import { PageHeader } from '../components/Layout';
import { ErrorMessage } from '../components/ui';
import { IconLogout } from '../components/Icons';

export function ProfilePage() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const [privateEmail, setPrivateEmail] = useState(user?.privateEmail ?? '');
  const [privateEmailError, setPrivateEmailError] = useState<string | null>(null);
  const [privateEmailSuccess, setPrivateEmailSuccess] = useState(false);
  const [privateEmailBusy, setPrivateEmailBusy] = useState(false);

  const handlePrivateEmailSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setPrivateEmailError(null);
    setPrivateEmailSuccess(false);
    setPrivateEmailBusy(true);
    try {
      await authApi.updatePrivateEmail(privateEmail.trim());
      setPrivateEmailSuccess(true);
      await refresh();
    } catch (err) {
      setPrivateEmailError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setPrivateEmailBusy(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (next !== repeat) {
      setError('Die beiden neuen Passwörter stimmen nicht überein.');
      return;
    }

    setBusy(true);
    try {
      await authApi.changePassword(current, next);
      setSuccess(true);
      setCurrent('');
      setNext('');
      setRepeat('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Änderung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Mein Konto" />

      {user?.mustChangePassword && (
        <div className="alert alert--info">
          Bitte vergib ein eigenes Passwort – dein Konto nutzt noch das vergebene Startpasswort.
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__body">
          <div className="detail-row">
            <span className="muted small">Name</span>
            <strong>{user?.name}</strong>
          </div>
          <div className="detail-row">
            <span className="muted small">E-Mail</span>
            <strong>{user?.email}</strong>
          </div>
          <div className="detail-row">
            <span className="muted small">Telefon</span>
            <strong>{user?.phone || '—'}</strong>
          </div>
          <div className="detail-row">
            <span className="muted small">Rolle</span>
            <strong>{user?.role === 'ADMIN' ? 'Administration' : 'Mitarbeiter'}</strong>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__header">
          <h2>Private E-Mail</h2>
        </div>
        <div className="card__body">
          <p className="muted small" style={{ marginBottom: 12 }}>
            Wird ausschließlich für „Passwort vergessen" genutzt – so klappt der Reset auch,
            wenn die Firmenmail gerade nicht erreichbar ist. Sonst nirgends sichtbar.
          </p>
          <ErrorMessage error={privateEmailError} />
          {privateEmailSuccess && (
            <div className="alert alert--success">Private E-Mail gespeichert.</div>
          )}
          <form onSubmit={handlePrivateEmailSubmit} noValidate style={{ maxWidth: 420 }}>
            <div className="field">
              <label htmlFor="privateEmail">Private E-Mail-Adresse</label>
              <input
                id="privateEmail"
                className="input"
                type="email"
                placeholder="max.mustermann@gmail.com"
                value={privateEmail}
                onChange={(event) => setPrivateEmail(event.target.value)}
              />
            </div>
            <button type="submit" className="btn" disabled={privateEmailBusy}>
              {privateEmailBusy ? 'Wird gespeichert …' : 'Speichern'}
            </button>
          </form>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__header">
          <h2>Passwort ändern</h2>
        </div>
        <div className="card__body">
          <ErrorMessage error={error} />
          {success && <div className="alert alert--success">Passwort erfolgreich geändert.</div>}

          <form onSubmit={handleSubmit} noValidate style={{ maxWidth: 420 }}>
            <div className="field">
              <label htmlFor="current">Aktuelles Passwort</label>
              <input
                id="current"
                className="input"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="next">Neues Passwort</label>
              <input
                id="next"
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={next}
                onChange={(event) => setNext(event.target.value)}
                required
              />
              <p className="field__hint">Mindestens 8 Zeichen.</p>
            </div>
            <div className="field">
              <label htmlFor="repeat">Neues Passwort wiederholen</label>
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
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'Wird gespeichert …' : 'Passwort speichern'}
            </button>
          </form>
        </div>
      </div>

      <button
        type="button"
        className="btn btn--ghost btn--block"
        onClick={() => {
          logout();
          navigate('/login', { replace: true });
        }}
      >
        <IconLogout size={18} />
        Abmelden
      </button>
    </>
  );
}
