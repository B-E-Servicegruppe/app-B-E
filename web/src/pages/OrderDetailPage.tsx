/**
 * Auftragsdetail – wird von beiden Rollen genutzt.
 *
 * Mitarbeiter sehen diese Seite nur für ihnen zugewiesene Aufträge (das prüft
 * das Backend; ein fremder Aufruf endet mit "nicht gefunden").
 *
 * Funktionen:
 *   - Kundenadresse mit Link zur Navigation (Google Maps)
 *   - Material als Checkliste zum Abhaken
 *   - Zeitfenster, Notizen des Admins, angehängte PDFs/Bilder
 *   - Status ändern (offen → in Arbeit → erledigt) mit Zeitstempel
 *   - Fotos als Abschluss-Nachweis hochladen (direkt über die Handy-Kamera)
 *   - Kommentarfeld für Rückmeldungen an die Administration
 *   - Für Admins zusätzlich: bearbeiten, duplizieren, löschen, stornieren
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, ordersApi } from '../api/client';
import type { OrderDetail, OrderStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, ErrorMessage, Loading, StatusBadge, Toast, TypeBadge } from '../components/ui';
import {
  IconCamera,
  IconCheck,
  IconChevronLeft,
  IconClock,
  IconCopy,
  IconEdit,
  IconMapPin,
  IconNote,
  IconPaperclip,
  IconPhone,
  IconTeam,
  IconTrash,
} from '../components/Icons';
import { STATUS_LABEL, nextStatus, nextStatusLabel } from '../utils/labels';
import { formatDate, formatDateTime, formatTimeRange, mapsLink } from '../utils/date';
import './pages.css';

export function OrderDetailPage() {
  const { id } = useParams();
  const orderId = Number(id);
  const navigate = useNavigate();
  const { isAdmin, user } = useAuth();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Zwei getrennte Auswahlfelder: Kamera (nur Handy) und Galerie/Dateien
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    ordersApi
      .get(orderId)
      .then(setOrder)
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 404
            ? 'Dieser Auftrag existiert nicht oder ist dir nicht zugewiesen.'
            : 'Der Auftrag konnte nicht geladen werden.'
        )
      )
      .finally(() => setLoading(false));
  };

  useEffect(load, [orderId]);

  // ── Aktionen ───────────────────────────────────────────────────────────
  const changeStatus = async (status: OrderStatus) => {
    if (!order) return;
    setBusy(true);
    try {
      const result = await ordersApi.setStatus(order.id, status);
      setOrder({ ...order, status: result.status, history: result.history });
      setToast(`Status geändert: ${STATUS_LABEL[status]}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Statusänderung fehlgeschlagen.');
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  };

  const toggleMaterial = async (materialId: number, done: boolean) => {
    if (!order) return;
    // Sofort umschalten, damit sich die Checkliste flüssig anfühlt
    setOrder({
      ...order,
      materials: order.materials.map((m) => (m.id === materialId ? { ...m, done } : m)),
    });
    try {
      const materials = await ordersApi.toggleMaterial(order.id, materialId, done);
      setOrder((current) => (current ? { ...current, materials } : current));
    } catch {
      setError('Die Materialliste konnte nicht gespeichert werden.');
      load();
    }
  };

  const uploadPhotos = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!order || files.length === 0) return;

    setBusy(true);
    try {
      const updated = await ordersApi.uploadFiles(
        order.id,
        files,
        isAdmin ? 'PROOF_PHOTO' : undefined
      );
      setOrder({ ...order, files: updated });
      setToast(files.length === 1 ? 'Foto hochgeladen' : `${files.length} Fotos hochgeladen`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const submitComment = async () => {
    if (!order || !comment.trim()) return;
    setBusy(true);
    try {
      const comments = await ordersApi.addComment(order.id, comment.trim());
      setOrder({ ...order, comments });
      setComment('');
      setToast('Rückmeldung gesendet');
    } catch {
      setError('Die Rückmeldung konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const copy = await ordersApi.duplicate(order.id);
      navigate(`/auftraege/${copy.id}/bearbeiten`);
    } catch {
      setError('Der Auftrag konnte nicht dupliziert werden.');
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!order) return;
    setBusy(true);
    try {
      await ordersApi.remove(order.id);
      navigate('/auftraege', { replace: true });
    } catch {
      setError('Der Auftrag konnte nicht gelöscht werden.');
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  // ── Anzeige ────────────────────────────────────────────────────────────
  if (loading) return <Loading />;

  if (!order) {
    return (
      <>
        <ErrorMessage error={error} />
        <Link to={isAdmin ? '/auftraege' : '/meine-auftraege'} className="btn btn--ghost">
          <IconChevronLeft size={18} />
          Zurück zur Übersicht
        </Link>
      </>
    );
  }

  const followUp = nextStatus(order.status);
  const attachments = order.files.filter((file) => file.kind === 'ATTACHMENT');
  const proofPhotos = order.files.filter((file) => file.kind === 'PROOF_PHOTO');
  const openMaterials = order.materials.filter((m) => !m.done).length;

  return (
    <>
      <button type="button" className="back-link" onClick={() => navigate(-1)}>
        <IconChevronLeft size={18} />
        Zurück
      </button>

      <PageHeader
        title={order.customerName}
        subtitle={`Auftrag #${order.id}`}
        actions={
          isAdmin ? (
            <>
              <Link to={`/auftraege/${order.id}/bearbeiten`} className="btn btn--ghost btn--sm">
                <IconEdit size={16} />
                <span className="hide-mobile">Bearbeiten</span>
              </Link>
              <button type="button" className="btn btn--ghost btn--sm" onClick={duplicate} disabled={busy}>
                <IconCopy size={16} />
                <span className="hide-mobile">Duplizieren</span>
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                <IconTrash size={16} />
                <span className="hide-mobile">Löschen</span>
              </button>
            </>
          ) : undefined
        }
      />

      <ErrorMessage error={error} />

      <div className="detail-grid">
        {/* ── Hauptspalte ──────────────────────────────────────────────── */}
        <div className="stack">
          {/* Status und Eckdaten */}
          <section className="card">
            <div className="card__body">
              <div className="row row--wrap" style={{ marginBottom: 14 }}>
                <StatusBadge status={order.status} size={16} />
                <TypeBadge type={order.orderType} />
              </div>

              <div className="detail-row">
                <span className="detail-row__label">
                  <IconMapPin size={16} />
                  Adresse
                </span>
                <div>
                  <div>{order.address}</div>
                  {/* Direkte Navigation – öffnet auf dem Handy die Maps-App */}
                  <a
                    href={mapsLink(order.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="detail-row__action"
                  >
                    In Google Maps öffnen
                  </a>
                </div>
              </div>

              {order.contactPhone && (
                <div className="detail-row">
                  <span className="detail-row__label">
                    <IconPhone size={16} />
                    Ansprechpartner
                  </span>
                  <a href={`tel:${order.contactPhone.replace(/\s/g, '')}`}>{order.contactPhone}</a>
                </div>
              )}

              <div className="detail-row">
                <span className="detail-row__label">
                  <IconClock size={16} />
                  Termin
                </span>
                <div>
                  <strong>{formatDate(order.scheduledDate)}</strong>
                  <div className="muted small">
                    {formatTimeRange(order.startTime, order.endTime)}
                  </div>
                </div>
              </div>

              <div className="detail-row">
                <span className="detail-row__label">
                  <IconTeam size={16} />
                  Zuständig
                </span>
                <span>
                  {order.assignees.length > 0
                    ? order.assignees.map((a) => a.name).join(', ')
                    : 'Noch niemandem zugewiesen'}
                </span>
              </div>
            </div>
          </section>

          {/* Statuswechsel */}
          {order.status !== 'STORNIERT' && (
            <section className="card">
              <div className="card__header">
                <h2>Status ändern</h2>
              </div>
              <div className="card__body">
                {followUp ? (
                  <button
                    type="button"
                    className="btn btn--accent btn--block status-btn"
                    onClick={() => changeStatus(followUp)}
                    disabled={busy}
                  >
                    <IconCheck size={20} />
                    {nextStatusLabel(order.status)}
                  </button>
                ) : (
                  <div className="alert alert--success" style={{ marginBottom: 0 }}>
                    <IconCheck size={18} />
                    Dieser Auftrag ist erledigt.
                  </div>
                )}

                {/* Zurücksetzen bzw. stornieren – nur Administration */}
                {isAdmin && (
                  <div className="row row--wrap" style={{ marginTop: 10 }}>
                    {order.status !== 'OFFEN' && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => changeStatus('OFFEN')}
                        disabled={busy}
                      >
                        Zurück auf offen
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setConfirmCancel(true)}
                      disabled={busy}
                    >
                      Auftrag stornieren
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Material als Checkliste */}
          {order.materials.length > 0 && (
            <section className="card">
              <div className="card__header">
                <h2>Material</h2>
                <span className="muted small">
                  {openMaterials === 0 ? 'vollständig' : `${openMaterials} offen`}
                </span>
              </div>
              <div className="card__body">
                <ul className="checklist">
                  {order.materials.map((material) => (
                    <li key={material.id}>
                      <label className="checklist__item">
                        <input
                          type="checkbox"
                          checked={material.done}
                          onChange={(event) => toggleMaterial(material.id, event.target.checked)}
                        />
                        <span className={material.done ? 'is-done' : ''}>
                          {material.name}
                          {material.quantity && (
                            <span className="muted small"> · {material.quantity}</span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* Notizen */}
          {order.notes && (
            <section className="card">
              <div className="card__header">
                <h2>
                  <IconNote size={18} /> Notizen
                </h2>
              </div>
              <div className="card__body">
                <p className="notes">{order.notes}</p>
              </div>
            </section>
          )}

          {/* Anhänge des Admins */}
          {attachments.length > 0 && (
            <section className="card">
              <div className="card__header">
                <h2>Unterlagen</h2>
              </div>
              <div className="card__body">
                <ul className="file-list">
                  {attachments.map((file) => (
                    <li key={file.id} className="file-list__item">
                      <IconPaperclip size={16} />
                      <a href={file.url} target="_blank" rel="noreferrer">
                        {file.originalName}
                      </a>
                      <span className="muted small">{Math.round(file.sizeBytes / 1024)} KB</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* Abschluss-Fotos */}
          <section className="card">
            <div className="card__header">
              <h2>Fotos zum Auftrag</h2>
              <span className="muted small">{proofPhotos.length}</span>
            </div>
            <div className="card__body">
              {proofPhotos.length > 0 && (
                <div className="photo-grid">
                  {proofPhotos.map((file) => (
                    <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="photo-grid__item">
                      {file.mimeType.startsWith('image/') ? (
                        <img src={file.url} alt={file.originalName} loading="lazy" />
                      ) : (
                        <span className="photo-grid__file">
                          <IconPaperclip size={20} />
                          {file.originalName}
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              )}

              {/* Zwei Wege: direkt fotografieren oder aus der Galerie wählen.
                  capture="environment" öffnet auf dem Handy die Rückkamera. */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={uploadPhotos}
                style={{ display: 'none' }}
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                onChange={uploadPhotos}
                style={{ display: 'none' }}
              />

              <div className="photo-actions">
                <button
                  type="button"
                  className="btn btn--block"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={busy}
                >
                  <IconCamera size={20} />
                  Foto aufnehmen
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--block"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={busy}
                >
                  <IconPaperclip size={18} />
                  Aus Galerie wählen
                </button>
              </div>
            </div>
          </section>

          {/* Rückmeldungen */}
          <section className="card">
            <div className="card__header">
              <h2>Rückmeldungen</h2>
            </div>
            <div className="card__body">
              {order.comments.length === 0 ? (
                <p className="muted small" style={{ marginTop: -4 }}>
                  Noch keine Rückmeldungen.
                </p>
              ) : (
                <ul className="comment-list">
                  {order.comments.map((entry) => (
                    <li key={entry.id} className="comment">
                      <div className="comment__head">
                        <strong>{entry.author ?? 'Unbekannt'}</strong>
                        {entry.authorRole === 'ADMIN' && (
                          <span className="comment__role">Administration</span>
                        )}
                        <span className="muted small">{formatDateTime(entry.createdAt)}</span>
                      </div>
                      <p className="comment__body">{entry.body}</p>
                    </li>
                  ))}
                </ul>
              )}

              <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
                <label htmlFor="comment">
                  {isAdmin ? 'Nachricht an das Team' : 'Rückmeldung an die Administration'}
                </label>
                <textarea
                  id="comment"
                  className="textarea"
                  rows={3}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="z. B. Zusatzarbeit nötig, Kunde nicht angetroffen, Material fehlt …"
                />
                <button
                  type="button"
                  className="btn btn--block"
                  style={{ marginTop: 8 }}
                  onClick={submitComment}
                  disabled={busy || !comment.trim()}
                >
                  Senden
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* ── Seitenspalte: Verlauf ────────────────────────────────────── */}
        <aside className="stack">
          <section className="card">
            <div className="card__header">
              <h2>Verlauf</h2>
            </div>
            <div className="card__body">
              <ol className="timeline">
                {order.history.map((entry) => (
                  <li key={entry.id} className="timeline__item">
                    <span className={`timeline__dot chip--${entry.toStatus}`} />
                    <div>
                      <strong>{STATUS_LABEL[entry.toStatus]}</strong>
                      {entry.fromStatus && (
                        <span className="muted small"> (vorher {STATUS_LABEL[entry.fromStatus]})</span>
                      )}
                      <div className="muted small">
                        {formatDateTime(entry.changedAt)}
                        {entry.changedBy && ` · ${entry.changedBy}`}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>

              <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
                Angelegt am {formatDateTime(order.createdAt)}
                {user && order.assignees.some((a) => a.id === user.id) && ' · dir zugewiesen'}
              </p>
            </div>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Auftrag löschen?"
        message={`Auftrag #${order.id} (${order.customerName}) wird endgültig gelöscht – einschließlich aller Dateien und des Verlaufs. Das lässt sich nicht rückgängig machen.`}
        confirmLabel="Endgültig löschen"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        open={confirmCancel}
        title="Auftrag stornieren?"
        message="Der Auftrag bleibt erhalten, wird aber als storniert gekennzeichnet."
        confirmLabel="Ja, stornieren"
        busy={busy}
        onConfirm={() => changeStatus('STORNIERT')}
        onCancel={() => setConfirmCancel(false)}
      />

      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
