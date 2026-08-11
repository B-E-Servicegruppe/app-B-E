/**
 * Dienstplan mit Wochen- und Monatsansicht.
 *
 * Administration:
 *   - Einträge anlegen, bearbeiten, löschen
 *   - Einträge per Drag & Drop auf einen anderen Tag ziehen (Maus/Desktop)
 *   - alternativ über den Dialog Tag und Mitarbeiter ändern (Touch-Bedienung)
 *   - Filter auf einzelne Mitarbeiter
 *
 * Mitarbeiter:
 *   - sehen ausschließlich die eigene Einteilung, ohne Bearbeitungsmöglichkeit
 *     (das erzwingt zusätzlich der Server)
 *
 * Farbliche Kennzeichnung wahlweise nach Auftragsart oder Status.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ordersApi, shiftsApi, usersApi } from '../api/client';
import type { AssignableUser, OrderListItem, Shift } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, ErrorMessage, Loading, Modal, Toast } from '../components/ui';
import { IconChevronLeft, IconChevronRight, IconPlus, IconTrash } from '../components/Icons';
import { STATUS_COLOR, STATUS_LABEL, TYPE_COLOR, TYPE_LABEL } from '../utils/labels';
import {
  addDays,
  addMonths,
  formatMonthYear,
  formatWeekRange,
  isSameMonth,
  isToday,
  monthGridDays,
  toISODate,
  today,
  WEEKDAY_NAMES,
  weekDays,
} from '../utils/date';
import './schedule.css';

type ViewMode = 'week' | 'month';
type ColorMode = 'type' | 'status';

export function SchedulePage() {
  const { isAdmin } = useAuth();

  const [view, setView] = useState<ViewMode>('week');
  const [colorMode, setColorMode] = useState<ColorMode>('type');
  const [reference, setReference] = useState(() => new Date());
  const [employeeFilter, setEmployeeFilter] = useState<string>('');

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<AssignableUser[]>([]);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Dialogzustand für Anlegen/Bearbeiten
  const [editing, setEditing] = useState<Shift | null>(null);
  const [creatingDate, setCreatingDate] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Shift | null>(null);
  const [busy, setBusy] = useState(false);

  /** Sichtbarer Zeitraum – hängt von der gewählten Ansicht ab. */
  const days = useMemo(
    () => (view === 'week' ? weekDays(reference) : monthGridDays(reference)),
    [view, reference]
  );
  const rangeFrom = toISODate(days[0]);
  const rangeTo = toISODate(days[days.length - 1]);

  const load = useCallback(() => {
    setLoading(true);
    shiftsApi
      .list(rangeFrom, rangeTo, employeeFilter ? Number(employeeFilter) : undefined)
      .then(setShifts)
      .catch(() => setError('Der Dienstplan konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, [rangeFrom, rangeTo, employeeFilter]);

  useEffect(load, [load]);

  // Auswahllisten nur für die Administration nötig
  useEffect(() => {
    if (!isAdmin) return;
    usersApi.assignable().then(setEmployees).catch(() => undefined);
    ordersApi.list({}).then(setOrders).catch(() => undefined);
  }, [isAdmin]);

  /** Einträge nach Datum gruppieren – so muss jeder Tag nur einmal suchen. */
  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const shift of shifts) {
      const list = map.get(shift.date) ?? [];
      list.push(shift);
      map.set(shift.date, list);
    }
    return map;
  }, [shifts]);

  /** Farbe eines Eintrags je nach gewähltem Modus. */
  const shiftColor = (shift: Shift): string => {
    if (!shift.order) return 'var(--text-muted)';
    return colorMode === 'type'
      ? TYPE_COLOR[shift.order.orderType]
      : STATUS_COLOR[shift.order.status];
  };

  // ── Drag & Drop (Desktop) ──────────────────────────────────────────────
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const handleDrop = async (date: string) => {
    setDropTarget(null);
    const shift = shifts.find((s) => s.id === draggedId);
    setDraggedId(null);
    if (!shift || shift.date === date) return;

    // Sofort verschieben (fühlt sich flüssig an), bei Fehler zurückladen
    setShifts((current) => current.map((s) => (s.id === shift.id ? { ...s, date } : s)));
    try {
      await shiftsApi.move(shift.id, date);
      setToast('Eintrag verschoben');
    } catch {
      setError('Der Eintrag konnte nicht verschoben werden.');
      load();
    }
  };

  const removeShift = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await shiftsApi.remove(confirmDelete.id);
      setShifts((current) => current.filter((s) => s.id !== confirmDelete.id));
      setToast('Eintrag gelöscht');
    } catch {
      setError('Der Eintrag konnte nicht gelöscht werden.');
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  };

  const goToday = () => setReference(new Date());
  const step = (direction: number) =>
    setReference((current) =>
      view === 'week' ? addDays(current, direction * 7) : addMonths(current, direction)
    );

  return (
    <>
      <PageHeader
        title={isAdmin ? 'Dienstplan' : 'Mein Dienstplan'}
        subtitle={
          isAdmin
            ? 'Einteilung des Teams – Einträge lassen sich auf andere Tage ziehen.'
            : 'Deine Einteilung im Überblick.'
        }
        actions={
          isAdmin ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEditing(null);
                setCreatingDate(today());
              }}
            >
              <IconPlus size={18} />
              Eintrag
            </button>
          ) : undefined
        }
      />

      <ErrorMessage error={error} />

      {/* ── Steuerung ───────────────────────────────────────────────────── */}
      <div className="card schedule-toolbar">
        <div className="schedule-toolbar__nav">
          <button type="button" className="icon-btn icon-btn--muted" onClick={() => step(-1)} aria-label="Zurück">
            <IconChevronLeft size={20} />
          </button>
          <strong className="schedule-toolbar__title">
            {view === 'week' ? formatWeekRange(reference) : formatMonthYear(reference)}
          </strong>
          <button type="button" className="icon-btn icon-btn--muted" onClick={() => step(1)} aria-label="Weiter">
            <IconChevronRight size={20} />
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={goToday}>
            Heute
          </button>
        </div>

        <div className="schedule-toolbar__options">
          {/* Wochen-/Monatsumschaltung */}
          <div className="segmented">
            <button
              type="button"
              className={view === 'week' ? 'is-active' : ''}
              onClick={() => setView('week')}
            >
              Woche
            </button>
            <button
              type="button"
              className={view === 'month' ? 'is-active' : ''}
              onClick={() => setView('month')}
            >
              Monat
            </button>
          </div>

          {/* Farbcodierung umschalten */}
          <select
            className="select select--sm"
            value={colorMode}
            onChange={(event) => setColorMode(event.target.value as ColorMode)}
            aria-label="Farbcodierung"
          >
            <option value="type">Farbe: Auftragsart</option>
            <option value="status">Farbe: Status</option>
          </select>

          {isAdmin && (
            <select
              className="select select--sm"
              value={employeeFilter}
              onChange={(event) => setEmployeeFilter(event.target.value)}
              aria-label="Mitarbeiter filtern"
            >
              <option value="">Alle Mitarbeiter</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ── Legende ─────────────────────────────────────────────────────── */}
      <div className="legend">
        {colorMode === 'type'
          ? Object.entries(TYPE_LABEL).map(([key, label]) => (
              <span key={key} className="legend__item">
                <span
                  className="legend__dot"
                  style={{ background: TYPE_COLOR[key as keyof typeof TYPE_COLOR] }}
                />
                {label}
              </span>
            ))
          : Object.entries(STATUS_LABEL).map(([key, label]) => (
              <span key={key} className="legend__item">
                <span
                  className="legend__dot"
                  style={{ background: STATUS_COLOR[key as keyof typeof STATUS_COLOR] }}
                />
                {label}
              </span>
            ))}
      </div>

      {/* ── Kalender ────────────────────────────────────────────────────── */}
      {loading ? (
        <Loading />
      ) : (
        <div className={`calendar calendar--${view}`}>
          {/* Wochentagsleiste (nur Monatsansicht auf großen Bildschirmen) */}
          {view === 'month' && (
            <div className="calendar__weekdays">
              {WEEKDAY_NAMES.map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
          )}

          <div className="calendar__grid">
            {days.map((day) => {
              const iso = toISODate(day);
              const dayShifts = shiftsByDate.get(iso) ?? [];
              const outsideMonth = view === 'month' && !isSameMonth(day, reference);

              return (
                <div
                  key={iso}
                  className={[
                    'calendar__day',
                    isToday(day) ? 'is-today' : '',
                    outsideMonth ? 'is-outside' : '',
                    dropTarget === iso ? 'is-drop-target' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  // Drag & Drop nur für die Administration
                  onDragOver={
                    isAdmin
                      ? (event) => {
                          event.preventDefault();
                          setDropTarget(iso);
                        }
                      : undefined
                  }
                  onDragLeave={isAdmin ? () => setDropTarget(null) : undefined}
                  onDrop={isAdmin ? () => handleDrop(iso) : undefined}
                >
                  <div className="calendar__day-head">
                    <span className="calendar__day-name">
                      {view === 'week' && WEEKDAY_NAMES[(day.getDay() + 6) % 7]}
                    </span>
                    <span className="calendar__day-number">{day.getDate()}</span>
                    {isAdmin && (
                      <button
                        type="button"
                        className="calendar__add"
                        onClick={() => {
                          setEditing(null);
                          setCreatingDate(iso);
                        }}
                        aria-label={`Eintrag am ${iso} anlegen`}
                      >
                        <IconPlus size={15} />
                      </button>
                    )}
                  </div>

                  <div className="calendar__entries">
                    {dayShifts.map((shift) => (
                      <div
                        key={shift.id}
                        className="shift"
                        style={{ borderLeftColor: shiftColor(shift) }}
                        draggable={isAdmin}
                        onDragStart={isAdmin ? () => setDraggedId(shift.id) : undefined}
                        onDragEnd={isAdmin ? () => setDraggedId(null) : undefined}
                        onClick={isAdmin ? () => setEditing(shift) : undefined}
                        role={isAdmin ? 'button' : undefined}
                        tabIndex={isAdmin ? 0 : undefined}
                        onKeyDown={
                          isAdmin
                            ? (event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  setEditing(shift);
                                }
                              }
                            : undefined
                        }
                      >
                        <span className="shift__time">
                          {shift.startTime ? `${shift.startTime}` : 'ganztägig'}
                        </span>
                        <span className="shift__title">
                          {shift.order ? shift.order.customerName : shift.title || 'Eintrag'}
                        </span>
                        {/* Bei gefilterter Ansicht ist der Name überflüssig */}
                        {isAdmin && !employeeFilter && (
                          <span className="shift__user">{shift.userName}</span>
                        )}
                        {shift.order && (
                          <Link
                            to={`/auftraege/${shift.order.id}`}
                            className="shift__link"
                            onClick={(event) => event.stopPropagation()}
                          >
                            Auftrag #{shift.order.id}
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && shifts.length === 0 && (
        <p className="muted center" style={{ marginTop: 16 }}>
          {isAdmin
            ? 'Für diesen Zeitraum gibt es noch keine Einteilung.'
            : 'Für diesen Zeitraum bist du nicht eingeteilt.'}
        </p>
      )}

      {/* ── Dialog: Eintrag anlegen/bearbeiten (nur Admin) ──────────────── */}
      {isAdmin && (editing || creatingDate) && (
        <ShiftDialog
          shift={editing}
          defaultDate={creatingDate ?? today()}
          employees={employees}
          orders={orders}
          onClose={() => {
            setEditing(null);
            setCreatingDate(null);
          }}
          onSaved={(message) => {
            setEditing(null);
            setCreatingDate(null);
            setToast(message);
            load();
          }}
          onDelete={(shift) => {
            setEditing(null);
            setConfirmDelete(shift);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Eintrag löschen?"
        message="Der Dienstplan-Eintrag wird entfernt. Der zugehörige Auftrag bleibt bestehen."
        confirmLabel="Löschen"
        danger
        busy={busy}
        onConfirm={removeShift}
        onCancel={() => setConfirmDelete(null)}
      />

      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Dialog zum Anlegen und Bearbeiten eines Dienstplan-Eintrags.
 * Über die Auswahl "Mitarbeiter" und "Datum" lässt sich ein Eintrag auch ohne
 * Drag & Drop verschieben – wichtig für die Bedienung auf dem Smartphone.
 */
function ShiftDialog({
  shift,
  defaultDate,
  employees,
  orders,
  onClose,
  onSaved,
  onDelete,
}: {
  shift: Shift | null;
  defaultDate: string;
  employees: AssignableUser[];
  orders: OrderListItem[];
  onClose: () => void;
  onSaved: (message: string) => void;
  onDelete: (shift: Shift) => void;
}) {
  const [userId, setUserId] = useState(String(shift?.userId ?? employees[0]?.id ?? ''));
  const [orderId, setOrderId] = useState(String(shift?.orderId ?? ''));
  const [date, setDate] = useState(shift?.date ?? defaultDate);
  const [startTime, setStartTime] = useState(shift?.startTime ?? '');
  const [endTime, setEndTime] = useState(shift?.endTime ?? '');
  const [title, setTitle] = useState(shift?.title ?? '');
  const [note, setNote] = useState(shift?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Übernimmt Termin und Zeitfenster aus dem gewählten Auftrag. */
  const handleOrderChange = (value: string) => {
    setOrderId(value);
    const order = orders.find((o) => String(o.id) === value);
    if (!order) return;
    if (order.scheduledDate) setDate(order.scheduledDate);
    if (order.startTime) setStartTime(order.startTime);
    if (order.endTime) setEndTime(order.endTime);
  };

  const save = async () => {
    setError(null);
    if (!userId) {
      setError('Bitte einen Mitarbeiter auswählen.');
      return;
    }

    setBusy(true);
    const input = {
      userId: Number(userId),
      orderId: orderId ? Number(orderId) : null,
      date,
      startTime: startTime || null,
      endTime: endTime || null,
      title: title.trim() || null,
      note: note.trim() || null,
    };

    try {
      if (shift) {
        await shiftsApi.update(shift.id, input);
        onSaved('Eintrag gespeichert');
      } else {
        await shiftsApi.create(input);
        onSaved('Eintrag angelegt');
      }
    } catch {
      setError('Speichern nicht möglich. Bitte Eingaben prüfen.');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={shift ? 'Eintrag bearbeiten' : 'Neuer Dienstplan-Eintrag'}
      onClose={onClose}
      footer={
        <>
          {shift && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => onDelete(shift)}
              disabled={busy}
            >
              <IconTrash size={16} />
              Löschen
            </button>
          )}
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
        <label htmlFor="s-user">Mitarbeiter *</label>
        <select
          id="s-user"
          className="select"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
        >
          <option value="">Bitte wählen</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="s-order">Auftrag (optional)</label>
        <select
          id="s-order"
          className="select"
          value={orderId}
          onChange={(event) => handleOrderChange(event.target.value)}
        >
          <option value="">Kein Auftrag (z. B. Urlaub, Werkstatt)</option>
          {orders.map((order) => (
            <option key={order.id} value={order.id}>
              #{order.id} · {order.customerName} · {TYPE_LABEL[order.orderType]}
            </option>
          ))}
        </select>
        <p className="field__hint">Termin und Zeitfenster werden automatisch übernommen.</p>
      </div>

      <div className="field">
        <label htmlFor="s-date">Datum *</label>
        <input
          id="s-date"
          className="input"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="s-start">Von</label>
          <input
            id="s-start"
            className="input"
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="s-end">Bis</label>
          <input
            id="s-end"
            className="input"
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
          />
        </div>
      </div>

      {!orderId && (
        <div className="field">
          <label htmlFor="s-title">Bezeichnung</label>
          <input
            id="s-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="z. B. Urlaub, Bereitschaft, Werkstatt"
          />
        </div>
      )}

      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="s-note">Notiz</label>
        <textarea
          id="s-note"
          className="textarea"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Modal>
  );
}
