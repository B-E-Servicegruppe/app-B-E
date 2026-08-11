/**
 * Formular zum Anlegen und Bearbeiten eines Auftrags (nur Administration).
 *
 * Enthält alle geforderten Felder:
 *   Kundenname, Adresse, Auftragsart, Zeitfenster/Termin,
 *   benötigtes Material (beliebig viele Positionen), Notizen,
 *   zuständige Mitarbeiter (Mehrfachauswahl) sowie Datei-Uploads
 *   (PDFs und Bilder, z. B. Angebot, Grundriss, Referenzfotos).
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, ordersApi, usersApi } from '../api/client';
import type { AssignableUser, OrderFile, OrderInput, OrderStatus, OrderType } from '../api/types';
import { PageHeader } from '../components/Layout';
import { ErrorMessage, Loading } from '../components/ui';
import { IconPaperclip, IconPlus, IconTrash, IconUpload } from '../components/Icons';
import { ORDER_STATUSES, ORDER_TYPES, STATUS_LABEL, TYPE_LABEL } from '../utils/labels';
import './pages.css';

/** Eine Materialzeile im Formular (id nur zur Darstellung). */
interface MaterialRow {
  key: number;
  name: string;
  quantity: string;
}

let rowCounter = 0;
const emptyRow = (): MaterialRow => ({ key: (rowCounter += 1), name: '', quantity: '' });

export function OrderFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Formularzustand ───────────────────────────────────────────────────
  const [customerName, setCustomerName] = useState('');
  const [address, setAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [orderType, setOrderType] = useState<OrderType>('REINIGUNG');
  const [status, setStatus] = useState<OrderStatus>('OFFEN');
  const [scheduledDate, setScheduledDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [notes, setNotes] = useState('');
  const [materials, setMaterials] = useState<MaterialRow[]>([emptyRow()]);
  const [assigneeIds, setAssigneeIds] = useState<number[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [existingFiles, setExistingFiles] = useState<OrderFile[]>([]);

  const [employees, setEmployees] = useState<AssignableUser[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Mitarbeiter für die Zuweisung laden
  useEffect(() => {
    usersApi.assignable().then(setEmployees).catch(() => undefined);
  }, []);

  // Beim Bearbeiten: bestehenden Auftrag laden und Formular vorbelegen
  useEffect(() => {
    if (!id) return;
    ordersApi
      .get(Number(id))
      .then((order) => {
        setCustomerName(order.customerName);
        setAddress(order.address);
        setContactPhone(order.contactPhone ?? '');
        setOrderType(order.orderType);
        setStatus(order.status);
        setScheduledDate(order.scheduledDate ?? '');
        setStartTime(order.startTime ?? '');
        setEndTime(order.endTime ?? '');
        setNotes(order.notes ?? '');
        setAssigneeIds(order.assignees.map((a) => a.id));
        setExistingFiles(order.files);
        setMaterials(
          order.materials.length
            ? order.materials.map((m) => ({
                key: (rowCounter += 1),
                name: m.name,
                quantity: m.quantity ?? '',
              }))
            : [emptyRow()]
        );
      })
      .catch(() => setError('Der Auftrag konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, [id]);

  const toggleAssignee = (employeeId: number) => {
    setAssigneeIds((current) =>
      current.includes(employeeId)
        ? current.filter((value) => value !== employeeId)
        : [...current, employeeId]
    );
  };

  const updateMaterial = (key: number, field: 'name' | 'quantity', value: string) => {
    setMaterials((rows) =>
      rows.map((row) => (row.key === key ? { ...row, [field]: value } : row))
    );
  };

  const removeMaterial = (key: number) => {
    setMaterials((rows) => (rows.length === 1 ? [emptyRow()] : rows.filter((r) => r.key !== key)));
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    setNewFiles((current) => [...current, ...selected].slice(0, 10));
    // Zurücksetzen, damit dieselbe Datei erneut gewählt werden kann
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeExistingFile = async (fileId: number) => {
    if (!id) return;
    try {
      const remaining = await ordersApi.removeFile(Number(id), fileId);
      setExistingFiles(remaining);
    } catch {
      setError('Die Datei konnte nicht entfernt werden.');
    }
  };

  /** Vorschau der Gesamtgröße aller neuen Dateien. */
  const totalSize = useMemo(
    () => newFiles.reduce((sum, file) => sum + file.size, 0),
    [newFiles]
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);

    const input: OrderInput = {
      customerName: customerName.trim(),
      address: address.trim(),
      contactPhone: contactPhone.trim() || null,
      orderType,
      status,
      scheduledDate: scheduledDate || null,
      startTime: startTime || null,
      endTime: endTime || null,
      notes: notes.trim() || null,
      // Leere Materialzeilen werden verworfen
      materials: materials
        .filter((row) => row.name.trim())
        .map((row) => ({ name: row.name.trim(), quantity: row.quantity.trim() || null })),
      assigneeIds,
    };

    try {
      const saved = isEdit
        ? await ordersApi.update(Number(id), input, newFiles)
        : await ordersApi.create(input, newFiles);
      navigate(`/auftraege/${saved.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.details) {
          setFieldErrors(
            Object.fromEntries(err.details.map((detail) => [detail.field, detail.message]))
          );
        }
      } else {
        setError('Speichern nicht möglich. Bitte erneut versuchen.');
      }
      setSaving(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader
        title={isEdit ? `Auftrag #${id} bearbeiten` : 'Neuer Auftrag'}
        subtitle={isEdit ? undefined : 'Alle Angaben lassen sich später ändern.'}
      />

      <ErrorMessage error={error} />

      <form onSubmit={handleSubmit} noValidate className="form-grid">
        {/* ── Kunde & Einsatzort ───────────────────────────────────────── */}
        <section className="card">
          <div className="card__header">
            <h2>Kunde und Einsatzort</h2>
          </div>
          <div className="card__body">
            <div className="field">
              <label htmlFor="customer">Kundenname *</label>
              <input
                id="customer"
                className="input"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                required
              />
              {fieldErrors.customerName && <p className="field__error">{fieldErrors.customerName}</p>}
            </div>

            <div className="field">
              <label htmlFor="address">Adresse *</label>
              <input
                id="address"
                className="input"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Straße Hausnummer, PLZ Ort"
                required
              />
              <p className="field__hint">
                Wird für die Navigation verwendet – bitte vollständig eingeben.
              </p>
              {fieldErrors.address && <p className="field__error">{fieldErrors.address}</p>}
            </div>

            <div className="field">
              <label htmlFor="phone">Telefon Ansprechpartner</label>
              <input
                id="phone"
                className="input"
                type="tel"
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
              />
            </div>
          </div>
        </section>

        {/* ── Art & Termin ─────────────────────────────────────────────── */}
        <section className="card">
          <div className="card__header">
            <h2>Auftragsart und Termin</h2>
          </div>
          <div className="card__body">
            <div className="field">
              <label htmlFor="type">Auftragsart *</label>
              <select
                id="type"
                className="select"
                value={orderType}
                onChange={(event) => setOrderType(event.target.value as OrderType)}
              >
                {ORDER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="date">Termin</label>
              <input
                id="date"
                className="input"
                type="date"
                value={scheduledDate}
                onChange={(event) => setScheduledDate(event.target.value)}
              />
            </div>

            <div className="form-row">
              <div className="field">
                <label htmlFor="start">Zeitfenster von</label>
                <input
                  id="start"
                  className="input"
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="end">bis</label>
                <input
                  id="end"
                  className="input"
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </div>
            </div>

            {isEdit && (
              <div className="field">
                <label htmlFor="status">Status</label>
                <select
                  id="status"
                  className="select"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as OrderStatus)}
                >
                  {ORDER_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {STATUS_LABEL[value]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </section>

        {/* ── Material ─────────────────────────────────────────────────── */}
        <section className="card">
          <div className="card__header">
            <h2>Benötigtes Material</h2>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setMaterials((rows) => [...rows, emptyRow()])}
            >
              <IconPlus size={16} />
              Position
            </button>
          </div>
          <div className="card__body">
            <p className="muted small" style={{ marginTop: -4 }}>
              Die Liste dient dem Team unterwegs als Checkliste.
            </p>

            {materials.map((row) => (
              <div key={row.key} className="material-row">
                <input
                  className="input"
                  placeholder="Bezeichnung, z. B. Streusalz"
                  value={row.name}
                  onChange={(event) => updateMaterial(row.key, 'name', event.target.value)}
                  aria-label="Material"
                />
                <input
                  className="input material-row__qty"
                  placeholder="Menge"
                  value={row.quantity}
                  onChange={(event) => updateMaterial(row.key, 'quantity', event.target.value)}
                  aria-label="Menge"
                />
                <button
                  type="button"
                  className="icon-btn icon-btn--muted"
                  onClick={() => removeMaterial(row.key)}
                  aria-label="Position entfernen"
                >
                  <IconTrash size={18} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ── Zuweisung ────────────────────────────────────────────────── */}
        <section className="card">
          <div className="card__header">
            <h2>Zuständige Mitarbeiter</h2>
          </div>
          <div className="card__body">
            <p className="muted small" style={{ marginTop: -4 }}>
              Mehrfachauswahl möglich. Nur zugewiesene Mitarbeiter sehen diesen Auftrag.
            </p>

            {employees.length === 0 ? (
              <p className="muted">Es sind noch keine aktiven Mitarbeiter angelegt.</p>
            ) : (
              <div className="check-list">
                {employees.map((employee) => (
                  <label key={employee.id} className="check-item">
                    <input
                      type="checkbox"
                      checked={assigneeIds.includes(employee.id)}
                      onChange={() => toggleAssignee(employee.id)}
                    />
                    <span>{employee.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Notizen ──────────────────────────────────────────────────── */}
        <section className="card">
          <div className="card__header">
            <h2>Notizen für das Team</h2>
          </div>
          <div className="card__body">
            <textarea
              className="textarea"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Besonderheiten, Schlüsselübergabe, Zufahrt, Ansprechpartner vor Ort …"
              aria-label="Notizen"
            />
          </div>
        </section>

        {/* ── Dateien ──────────────────────────────────────────────────── */}
        <section className="card">
          <div className="card__header">
            <h2>Anhänge</h2>
          </div>
          <div className="card__body">
            <p className="muted small" style={{ marginTop: -4 }}>
              PDFs und Bilder, z. B. Angebot, Grundriss oder Referenzfotos (max. 20 MB je Datei).
            </p>

            {/* Bereits gespeicherte Dateien (nur beim Bearbeiten) */}
            {existingFiles.length > 0 && (
              <ul className="file-list">
                {existingFiles.map((file) => (
                  <li key={file.id} className="file-list__item">
                    <IconPaperclip size={16} />
                    <a href={file.url} target="_blank" rel="noreferrer">
                      {file.originalName}
                    </a>
                    <span className="spacer" />
                    <button
                      type="button"
                      className="icon-btn icon-btn--muted"
                      onClick={() => removeExistingFile(file.id)}
                      aria-label="Datei löschen"
                    >
                      <IconTrash size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Neu ausgewählte Dateien */}
            {newFiles.length > 0 && (
              <ul className="file-list">
                {newFiles.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="file-list__item">
                    <IconPaperclip size={16} />
                    <span>{file.name}</span>
                    <span className="muted small">{Math.round(file.size / 1024)} KB</span>
                    <span className="spacer" />
                    <button
                      type="button"
                      className="icon-btn icon-btn--muted"
                      onClick={() => setNewFiles((files) => files.filter((_, i) => i !== index))}
                      aria-label="Datei entfernen"
                    >
                      <IconTrash size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => fileInputRef.current?.click()}
            >
              <IconUpload size={18} />
              Dateien auswählen
            </button>
            {totalSize > 0 && (
              <p className="field__hint">Gesamt {Math.round(totalSize / 1024)} KB ausgewählt.</p>
            )}
          </div>
        </section>

        {/* ── Speichern ────────────────────────────────────────────────── */}
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" onClick={() => navigate(-1)}>
            Abbrechen
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Wird gespeichert …' : isEdit ? 'Änderungen speichern' : 'Auftrag anlegen'}
          </button>
        </div>
      </form>
    </>
  );
}
