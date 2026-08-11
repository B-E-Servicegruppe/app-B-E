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
import { IconBox, IconMapPin, IconPaperclip, IconTeam } from './Icons';
import './order-card.css';

export function OrderCard({ order, showAssignees }: { order: OrderListItem; showAssignees?: boolean }) {
  return (
    <Link to={`/auftraege/${order.id}`} className="order-card">
      {/* Farbstreifen zeigt die Auftragsart auf einen Blick */}
      <span className="order-card__stripe" style={{ background: TYPE_COLOR[order.orderType] }} />

      <div className="order-card__content">
        <div className="order-card__top">
          <div className="order-card__title">
            <h3>{order.customerName}</h3>
            <span className="muted small">Auftrag #{order.id}</span>
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
          <span className="order-card__date">
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
