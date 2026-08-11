/**
 * Kleine, überall wiederverwendete Bausteine:
 * Status-Chip, Auftragsart-Chip, Dialog, Ladeanzeige, Leerzustand, Bestätigung.
 */
import { useEffect, type ReactNode } from 'react';
import type { OrderStatus, OrderType } from '../api/types';
import { STATUS_LABEL, TYPE_COLOR, TYPE_LABEL } from '../utils/labels';
import { STATUS_ICON, IconClose } from './Icons';
import './ui.css';

/** Status mit Icon und Farbe – identisch in allen Ansichten. */
export function StatusBadge({ status, size = 14 }: { status: OrderStatus; size?: number }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={`chip chip--${status}`}>
      <Icon size={size} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Auftragsart mit Farbpunkt (gleiche Farben wie im Dienstplan). */
export function TypeBadge({ type }: { type: OrderType }) {
  return (
    <span className="chip chip--type">
      <span className="chip__dot" style={{ background: TYPE_COLOR[type] }} />
      {TYPE_LABEL[type]}
    </span>
  );
}

/** Ladeanzeige mit Text. */
export function Loading({ text = 'Wird geladen …' }: { text?: string }) {
  return (
    <div className="loading">
      <span className="spinner" />
      <span>{text}</span>
    </div>
  );
}

/** Hinweis, wenn eine Liste leer ist. */
export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon">{icon}</div>}
      <h3 style={{ marginBottom: 6 }}>{title}</h3>
      {text && <p className="muted">{text}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

/** Fehlermeldung in einheitlicher Gestaltung. */
export function ErrorMessage({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="alert alert--error">{error}</div>;
}

/**
 * Dialogfenster.
 * Auf dem Smartphone erscheint es als Blatt von unten (leichter erreichbar),
 * auf großen Bildschirmen mittig.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  // Schließen mit der Escape-Taste
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    // Hintergrund nicht mitscrollen lassen
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className={`modal${wide ? ' modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <h2>{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Schließen">
            <IconClose size={20} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
}

/** Sicherheitsabfrage vor unwiderruflichen Aktionen (z. B. Löschen). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Ja, ausführen',
  danger,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Abbrechen
          </button>
          <button
            type="button"
            className={`btn${danger ? ' btn--danger' : ''}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Bitte warten …' : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{message}</p>
    </Modal>
  );
}

/** Kurze Erfolgsmeldung, die von selbst wieder verschwindet. */
export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDone, 3200);
    return () => clearTimeout(timer);
  }, [message, onDone]);

  if (!message) return null;
  return <div className="toast">{message}</div>;
}
