/**
 * Mitarbeiterverwaltung (nur Administration).
 *
 * - Liste aller Konten mit Status (aktiv / deaktiviert)
 * - Neues Konto anlegen: Name, E-Mail, Kontaktdaten, Rolle
 *   Das Startpasswort wird auf Wunsch automatisch erzeugt und einmalig
 *   angezeigt – zum Weitergeben an den Mitarbeiter.
 * - Konto bearbeiten und deaktivieren (bewusst kein Löschen, damit die
 *   Auftragshistorie vollständig bleibt)
 */
import { useEffect, useState } from 'react';
import { ApiError, usersApi } from '../api/client';
import type { User } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, ErrorMessage, Loading, Modal, Toast } from '../components/ui';
import { IconLock, IconPlus, IconTeam, IconUser } from '../components/Icons';
import { EmptyState } from '../components/ui';
import './pages.css';

export function EmployeesPage() {
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState<User | null>(null);
  const [passwordFor, setPasswordFor] = useState<User | null>(null);
  /** Einmalig angezeigtes Passwort nach Anlegen/Zurücksetzen. */
  const [revealedPassword, setRevealedPassword] = useState<{ name: string; password: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    usersApi
      .list()
      .then(setUsers)
      .catch(() => setError('Die Mitarbeiterliste konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const toggleActive = async () => {
    if (!confirmToggle) return;
    setBusy(true);
    try {
      const updated = await usersApi.setActive(confirmToggle.id, !confirmToggle.active);
      setUsers((current) =>
        current.map((u) => (u.id === updated.id ? { ...u, active: updated.active } : u))
      );
      setToast(updated.active ? 'Konto wieder aktiviert' : 'Konto deaktiviert');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Änderung nicht möglich.');
    } finally {
      setBusy(false);
      setConfirmToggle(null);
    }
  };

  const resetPassword = async () => {
    if (!passwordFor) return;
    setBusy(true);
    try {
      const result = await usersApi.resetPassword(passwordFor.id);
      setRevealedPassword({ name: passwordFor.name, password: result.initialPassword });
    } catch {
      setError('Das Passwort konnte nicht zurückgesetzt werden.');
    } finally {
      setBusy(false);
      setPasswordFor(null);
    }
  };

  const activeUsers = users.filter((u) => u.active);
  const inactiveUsers = users.filter((u) => !u.active);

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader
        title="Mitarbeiter"
        subtitle={`${activeUsers.length} aktiv · ${inactiveUsers.length} deaktiviert`}
        actions={
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            <IconPlus size={18} />
            Neuer Mitarbeiter
          </button>
        }
      />

      <ErrorMessage error={error} />

      {users.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconTeam size={40} />}
            title="Noch keine Konten angelegt"
            text="Lege das erste Mitarbeiterkonto an."
          />
        </div>
      ) : (
        <div className="user-list">
          {[...activeUsers, ...inactiveUsers].map((user) => (
            <div key={user.id} className={`card user-card${user.active ? '' : ' is-inactive'}`}>
              <div className="card__body">
                <div className="user-card__top">
                  <span className="user-card__avatar">
                    <IconUser size={20} />
                  </span>
                  <div className="user-card__identity">
                    <h3>{user.name}</h3>
                    <span className="muted small">{user.email}</span>
                  </div>
                  <span className={`chip ${user.active ? 'chip--ERLEDIGT' : 'chip--STORNIERT'}`}>
                    {user.active ? 'aktiv' : 'deaktiviert'}
                  </span>
                </div>

                <div className="user-card__meta">
                  <span className="chip chip--type">
                    {user.role === 'ADMIN' ? 'Administration' : 'Mitarbeiter'}
                  </span>
                  {user.phone && <span className="muted small">{user.phone}</span>}
                  {typeof user.openOrders === 'number' && user.openOrders > 0 && (
                    <span className="muted small">
                      {user.openOrders} laufende{user.openOrders === 1 ? 'r' : ''} Auftrag
                      {user.openOrders === 1 ? '' : 'e'}
                    </span>
                  )}
                  {user.mustChangePassword && (
                    <span className="muted small">Startpasswort noch nicht geändert</span>
                  )}
                </div>

                <div className="user-card__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setEditing(user)}
                  >
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setPasswordFor(user)}
                  >
                    <IconLock size={15} />
                    Passwort
                  </button>
                  {/* Das eigene Konto kann nicht deaktiviert werden */}
                  {user.id !== currentUser?.id && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setConfirmToggle(user)}
                    >
                      {user.active ? 'Deaktivieren' : 'Aktivieren'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Dialoge ─────────────────────────────────────────────────────── */}
      {(creating || editing) && (
        <UserDialog
          user={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(message, password, name) => {
            setCreating(false);
            setEditing(null);
            setToast(message);
            if (password && name) setRevealedPassword({ name, password });
            load();
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirmToggle)}
        title={confirmToggle?.active ? 'Konto deaktivieren?' : 'Konto aktivieren?'}
        message={
          confirmToggle?.active
            ? `${confirmToggle?.name} kann sich anschließend nicht mehr anmelden. Bereits erledigte Aufträge bleiben vollständig erhalten.`
            : `${confirmToggle?.name} kann sich anschließend wieder anmelden.`
        }
        confirmLabel={confirmToggle?.active ? 'Deaktivieren' : 'Aktivieren'}
        danger={confirmToggle?.active}
        busy={busy}
        onConfirm={toggleActive}
        onCancel={() => setConfirmToggle(null)}
      />

      <ConfirmDialog
        open={Boolean(passwordFor)}
        title="Passwort zurücksetzen?"
        message={`Für ${passwordFor?.name} wird ein neues Startpasswort erzeugt. Das bisherige Passwort verliert damit seine Gültigkeit.`}
        confirmLabel="Neues Passwort erzeugen"
        busy={busy}
        onConfirm={resetPassword}
        onCancel={() => setPasswordFor(null)}
      />

      {/* Einmalige Anzeige des Startpassworts */}
      <Modal
        open={Boolean(revealedPassword)}
        title="Startpasswort"
        onClose={() => setRevealedPassword(null)}
        footer={
          <button type="button" className="btn" onClick={() => setRevealedPassword(null)}>
            Verstanden
          </button>
        }
      >
        <p>
          Bitte an <strong>{revealedPassword?.name}</strong> weitergeben. Das Passwort wird{' '}
          <strong>nur jetzt</strong> angezeigt und lässt sich später nicht mehr auslesen.
        </p>
        <div className="password-reveal">{revealedPassword?.password}</div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Beim ersten Anmelden wird zum Ändern des Passworts aufgefordert.
        </p>
      </Modal>

      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
/** Dialog zum Anlegen und Bearbeiten eines Kontos. */
function UserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: User | null;
  onClose: () => void;
  onSaved: (message: string, password?: string, name?: string) => void;
}) {
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [role, setRole] = useState<'ADMIN' | 'EMPLOYEE'>(user?.role ?? 'EMPLOYEE');
  const [useOwnPassword, setUseOwnPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      if (user) {
        await usersApi.update(user.id, { name: name.trim(), email: email.trim(), phone: phone.trim(), role });
        onSaved('Konto gespeichert');
      } else {
        const result = await usersApi.create({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          role,
          ...(useOwnPassword && password ? { password } : {}),
        });
        onSaved('Konto angelegt', result.initialPassword, result.user.name);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern nicht möglich.');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={user ? 'Konto bearbeiten' : 'Neuer Mitarbeiter'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn" onClick={save} disabled={busy}>
            {busy ? 'Wird gespeichert …' : 'Speichern'}
          </button>
        </>
      }
    >
      <ErrorMessage error={error} />

      <div className="field">
        <label htmlFor="u-name">Name *</label>
        <input
          id="u-name"
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="u-email">E-Mail (dient als Benutzername) *</label>
        <input
          id="u-email"
          className="input"
          type="email"
          autoCapitalize="none"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="u-phone">Telefon</label>
        <input
          id="u-phone"
          className="input"
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="u-role">Rolle</label>
        <select
          id="u-role"
          className="select"
          value={role}
          onChange={(event) => setRole(event.target.value as 'ADMIN' | 'EMPLOYEE')}
        >
          <option value="EMPLOYEE">Mitarbeiter</option>
          <option value="ADMIN">Administration (Vollzugriff)</option>
        </select>
        <p className="field__hint">
          Mitarbeiter sehen ausschließlich die ihnen zugewiesenen Aufträge und den eigenen
          Dienstplan.
        </p>
      </div>

      {!user && (
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="check-item" style={{ marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={useOwnPassword}
              onChange={(event) => setUseOwnPassword(event.target.checked)}
            />
            <span>Startpasswort selbst vergeben</span>
          </label>

          {useOwnPassword ? (
            <input
              className="input"
              type="text"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Mindestens 8 Zeichen"
            />
          ) : (
            <p className="field__hint" style={{ marginTop: 0 }}>
              Ohne Häkchen erzeugt das System ein sicheres Startpasswort und zeigt es einmalig an.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
