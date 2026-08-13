/**
 * Auftragskachel für Listen (Admin-Auftragsliste und "Meine Aufträge").
 *
 * Bewusst als große, gut antippbare Fläche gestaltet – die Kachel ist auf dem
 * Smartphone das wichtigste Bedienelement.
 */
import { Link } from 'react-router-dom';
import type { OrderListItem } from '../api/types';
import { TYPE_COLOR } from '../utils/labels';
import { formatDateShort, formatTimeRange } from '../utils/date';
import { StatusBadge, TypeBadge } from './ui';
import { IconBox, IconMapPin, IconPaperclip, IconRepeat, IconTeam } from './Icons';
import './order-card.css';

export function OrderCard({
  order,
  showAssignees,
  selectable,
  selected,
  onToggleSelect,
  linkToDetail,
}: {
  order: OrderListItem;
  showAssignees?: boolean;
  /** Mehrfachauswahl aktiv (z. B. zum Sammel-Löschen) – deaktiviert bei gruppierten Serien-Karten. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
  /**
   * Immer zum einzelnen Auftrag verlinken, auch wenn er zu einer Serie
   * gehört – genutzt in der "Serie: alle Termine"-Ansicht, wo man ja gerade
   * IN der Serie ist und jeden Termin einzeln öffnen will, statt wieder zur
   * Serienübersicht zu springen.
   */
  linkToDetail?: boolean;
}) {
  // Eine Serie steht in normalen Listen nur als eine Karte – Klick führt zur
  // Übersicht aller ihrer Einzeltermine statt direkt zu diesem einen Termin.
  const isSeriesCard = !linkToDetail && Boolean(order.seriesId && order.seriesOccurrenceCount);
  const target = isSeriesCard ? `/auftraege?seriesId=${order.seriesId}` : `/auftraege/${order.id}`;
  const canSelect = selectable && !isSeriesCard;

  return (
    <Link
      to={target}
      className={`order-card${selected ? ' order-card--selected' : ''}`}
      onClick={(event) => {
        if (canSelect) {
          event.preventDefault();
          onToggleSelect?.(order.id);
        }
      }}
    >
      {canSelect && (
        <span className="order-card__checkbox" aria-hidden="true">
          <input type="checkbox" checked={Boolean(selected)} readOnly tabIndex={-1} />
        </span>
      )}
      {/* Farbstreifen zeigt die Auftragsart auf einen Blick */}
      <span className="order-card__stripe" style={{ background: TYPE_COLOR[order.orderType] }} />

      <div className="order-card__content">
        <div className="order-card__top">
          <div className="order-card__title">
            <h3>{order.customerName}</h3>
            <span className="muted small">
              {isSeriesCard ? `Wiederkehrend · ${order.seriesOccurrenceCount} Termine` : `Auftrag #${order.id}`}
            </span>
          </div>
          <StatusBadge status={order.status} />
        </div>

        <div className="order-card__meta">
          <span className="order-card__meta-item">
            <IconMapPin size={15} />
            {order.address}
          </span>
        </div>

        <div className="order-card__tags">
          <TypeBadge type={order.orderType} />
          {order.subtype && <span className="muted small">{order.subtype}</span>}
          {isSeriesCard && (
            <span className="order-card__meta-item">
              <IconRepeat size={13} />
            </span>
          )}
          <span className="order-card__date">
            {isSeriesCard ? 'Nächster Termin: ' : ''}
            {formatDateShort(order.scheduledDate)} · {formatTimeRange(order.startTime, order.endTime)}
          </span>
        </div>

        <div className="order-card__footer">
          {showAssignees && order.assignees.length > 0 && (
            <span className="order-card__footer-item">
              <IconTeam size={14} />
              {order.assignees.map((a) => a.name).join(', ')}
            </span>
          )}
          {order.materialCount > 0 && (
            <span className="order-card__footer-item">
              <IconBox size={14} />
              {order.materialCount} Material
            </span>
          )}
          {order.fileCount > 0 && (
            <span className="order-card__footer-item">
              <IconPaperclip size={14} />
              {order.fileCount} {order.fileCount === 1 ? 'Datei' : 'Dateien'}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
