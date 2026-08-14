/**
 * Urlaubsverwaltung.
 *
 * Mitarbeiter: Antrag stellen + eigene Anträge mit Status verfolgen.
 * Administration: Anträge genehmigen/ablehnen + jährliche Urlaubskontingente
 *                  je Mitarbeiter pflegen (mit automatisch berechnetem
 *                  Verbrauch aus genehmigten Anträgen).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError, leaveApi } from '../api/client';
import type { LeaveAllowanceEntry, LeaveRequest } from '../api/types';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, EmptyState, ErrorMessage, Loading, Modal, Toast } from '../components/ui';
import { IconCheck, IconClose, IconSun, IconTrash } from '../components/Icons';
import './pages.css';

const STATUS_LABEL: Record<LeaveRequest['status'], string> = {
  PENDING: 'Offen',
  APPROVED: 'Genehmigt',
  REJECTED: 'Abgelehnt',
};
const STATUS_CLASS: Record<LeaveRequest['status'], string> = {
  PENDING: 'chip--OFFEN',
  APPROVED: 'chip--ERLEDIGT',
  REJECTED: 'chip--STORNIERT',
};

function formatDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function LeavePage() {
  const { isAdmin } = useAuth();
  return isAdmin ? <AdminLeaveView /> : <EmployeeLeaveView />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mitarbeiteransicht
// ─────────────────────────────────────────────────────────────────────────────
function EmployeeLeaveView() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<LeaveRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    leaveApi
      .list()
      .then(setRequests)
      .catch(() => setError('Die Anträge konnten nicht geladen werden.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const cancel = async () => {
    if (!confirmCancel) return;
    setBusy(true);
    try {
      await leaveApi.remove(confirmCancel.id);
      setToast('Antrag zurückgezogen.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Zurückziehen nicht möglich.');
    } finally {
      setBusy(false);
      setConfirmCancel(null);
    }
  };

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader
        title="Urlaub"
        subtitle={`${requests.length} Anträge`}
        actions={
          <button type="button" className="btn" onClick={() => setShowForm(true)}>
            <IconSun size={18} />
            Urlaub beantragen
          </button>
        }
      />

      <ErrorMessage error={error} />

      {requests.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconSun size={40} />}
            title="Noch keine Urlaubsanträge"
            text="Stelle deinen ersten Antrag – die Administration wird automatisch benachrichtigt."
          />
        </div>
      ) : (
        <div className="user-list">
          {requests.map((r) => (
            <div key={r.id} className="card user-card">
              <div className="card__body">
                <div className="user-card__top">
                  <div className="user-card__identity">
                    <h3>
                      {formatDate(r.startDate)} – {formatDate(r.endDate)}
                    </h3>
                    <span className="muted small">{r.daysCount} Arbeitstage</span>
                  </div>
                  <span className={`chip ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </div>
                {r.reason && <p className="muted small" style={{ marginTop: 8 }}>{r.reason}</p>}
                {r.status === 'REJECTED' && r.decisionNote && (
                  <p className="field__error" style={{ marginTop: 8 }}>
                    Begründung: {r.decisionNote}
                  </p>
                )}
                {r.status === 'PENDING' && (
                  <div className="user-card__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setConfirmCancel(r)}
                    >
                      <IconTrash size={15} />
                      Zurückziehen
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <LeaveRequestDialog
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            setToast('Antrag gestellt – die Administration wurde benachrichtigt.');
            load();
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirmCancel)}
        title="Antrag zurückziehen?"
        message="Der Antrag wird entfernt."
        confirmLabel="Zurückziehen"
        danger
        busy={busy}
        onConfirm={cancel}
        onCancel={() => setConfirmCancel(null)}
      />

      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

function LeaveRequestDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await leaveApi.create({ startDate, endDate, reason: reason.trim() || null });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Antrag konnte nicht gestellt werden.');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Urlaub beantragen"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="submit" form="leave-request-form" className="btn" disabled={busy}>
            {busy ? 'Wird gesendet …' : 'Antrag senden'}
          </button>
        </>
      }
    >
      <ErrorMessage error={error} />
      <form id="leave-request-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="l-start">Von</label>
          <input
            id="l-start"
            className="input"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="l-end">Bis</label>
          <input
            id="l-end"
            className="input"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="l-reason">Anmerkung (optional)</label>
          <textarea
            id="l-reason"
            className="textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </form>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin-Ansicht
// ─────────────────────────────────────────────────────────────────────────────
function AdminLeaveView() {
  const [tab, setTab] = useState<'requests' | 'allowances'>('requests');
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [allowances, setAllowances] = useState<LeaveAllowanceEntry[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const loadRequests = () => {
    setLoading(true);
    leaveApi
      .list()
      .then(setRequests)
      .catch(() => setError('Die Anträge konnten nicht geladen werden.'))
      .finally(() => setLoading(false));
  };
  const loadAllowances = () => {
    setLoading(true);
    leaveApi
      .allowances(year)
      .then((r) => setAllowances(r.employees))
      .catch(() => setError('Die Kontingente konnten nicht geladen werden.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (tab === 'requests') loadRequests();
    else loadAllowances();
  }, [tab, year]);

  const decide = async (request: LeaveRequest, decision: 'APPROVED' | 'REJECTED', note?: string) => {
    setDecidingId(request.id);
    try {
      await leaveApi.decide(request.id, decision, note);
      setToast(decision === 'APPROVED' ? 'Antrag genehmigt – Dienstplan aktualisiert.' : 'Antrag abgelehnt.');
      loadRequests();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Entscheidung nicht möglich.');
    } finally {
      setDecidingId(null);
      setRejectTarget(null);
      setRejectNote('');
    }
  };

  const pending = requests.filter((r) => r.status === 'PENDING');
  const decided = requests.filter((r) => r.status !== 'PENDING');

  return (
    <>
      <PageHeader title="Urlaub" subtitle={tab === 'requests' ? `${pending.length} offene Anträge` : `Kontingente ${year}`} />

      <div className="tabs" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={`tabs__item${tab === 'requests' ? ' is-active' : ''}`}
          onClick={() => setTab('requests')}
        >
          Anträge
        </button>
        <button
          type="button"
          className={`tabs__item${tab === 'allowances' ? ' is-active' : ''}`}
          onClick={() => setTab('allowances')}
        >
          Kontingente
        </button>
      </div>

      <ErrorMessage error={error} />

      {loading ? (
        <Loading />
      ) : tab === 'requests' ? (
        requests.length === 0 ? (
          <div className="card">
            <EmptyState icon={<IconSun size={40} />} title="Keine Urlaubsanträge" text="Es liegen noch keine Anträge vor." />
          </div>
        ) : (
          <div className="user-list">
            {[...pending, ...decided].map((r) => (
              <div key={r.id} className="card user-card">
                <div className="card__body">
                  <div className="user-card__top">
                    <div className="user-card__identity">
                      <h3>{r.userName}</h3>
                      <span className="muted small">
                        {formatDate(r.startDate)} – {formatDate(r.endDate)} · {r.daysCount} Arbeitstage
                      </span>
                    </div>
                    <span className={`chip ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  </div>
                  {r.reason && <p className="muted small" style={{ marginTop: 8 }}>{r.reason}</p>}

                  {r.status === 'PENDING' && (
                    <div className="user-card__actions">
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => decide(r, 'APPROVED')}
                        disabled={decidingId === r.id}
                      >
                        <IconCheck size={15} />
                        Genehmigen
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setRejectTarget(r)}
                        disabled={decidingId === r.id}
                      >
                        <IconClose size={15} />
                        Ablehnen
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <AllowanceTable
          entries={allowances}
          year={year}
          onYearChange={setYear}
          onSaved={(msg) => {
            setToast(msg);
            loadAllowances();
          }}
        />
      )}

      <Modal
        open={Boolean(rejectTarget)}
        title="Antrag ablehnen"
        onClose={() => setRejectTarget(null)}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setRejectTarget(null)}>
              Abbrechen
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => rejectTarget && decide(rejectTarget, 'REJECTED', rejectNote.trim() || undefined)}
              disabled={decidingId === rejectTarget?.id}
            >
              Ablehnen
            </button>
          </>
        }
      >
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="reject-note">Begründung (optional, für den Mitarbeiter sichtbar)</label>
          <textarea
            id="reject-note"
            className="textarea"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
          />
        </div>
      </Modal>

      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

function AllowanceTable({
  entries,
  year,
  onYearChange,
  onSaved,
}: {
  entries: LeaveAllowanceEntry[];
  year: number;
  onYearChange: (y: number) => void;
  onSaved: (message: string) => void;
}) {
  const [editingTotal, setEditingTotal] = useState<Record<number, string>>({});
  const [editingManual, setEditingManual] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const save = async (entry: LeaveAllowanceEntry) => {
    const total = Number(editingTotal[entry.userId] ?? entry.daysTotal);
    const manual = Number(editingManual[entry.userId] ?? entry.daysUsedManual);
    if (Number.isNaN(total) || total < 0 || Number.isNaN(manual) || manual < 0) return;
    setBusyId(entry.userId);
    try {
      await leaveApi.setAllowance(entry.userId, year, total, manual);
      onSaved('Kontingent gespeichert.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card">
      <div className="card__header">
        <h2>Jährliches Kontingent</h2>
        <select
          className="select"
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
          style={{ maxWidth: 120 }}
        >
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small" style={{ margin: '0 20px 12px' }}>
        "Über App" zählt automatisch aus genehmigten Anträgen. "Manuell erfasst" ist für Urlaub,
        der außerhalb der App genommen wurde (z. B. vor der Einführung) – beides zusammen ergibt
        den Gesamtverbrauch.
      </p>
      <div className="card__body" style={{ overflowX: 'auto' }}>
        {entries.length === 0 ? (
          <p className="muted small">Keine Mitarbeiterkonten vorhanden.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th>Kontingent {year}</th>
                <th>Über App</th>
                <th>Manuell erfasst</th>
                <th>Verbleibend</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.userId}>
                  <td>{entry.name}</td>
                  <td>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step={0.5}
                      style={{ maxWidth: 90 }}
                      value={editingTotal[entry.userId] ?? String(entry.daysTotal)}
                      onChange={(e) =>
                        setEditingTotal((current) => ({ ...current, [entry.userId]: e.target.value }))
                      }
                    />
                  </td>
                  <td>{entry.daysUsedSystem}</td>
                  <td>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step={0.5}
                      style={{ maxWidth: 90 }}
                      value={editingManual[entry.userId] ?? String(entry.daysUsedManual)}
                      onChange={(e) =>
                        setEditingManual((current) => ({ ...current, [entry.userId]: e.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <strong>{entry.daysRemaining}</strong>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => save(entry)}
                      disabled={busyId === entry.userId}
                    >
                      Speichern
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
