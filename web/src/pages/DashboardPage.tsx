/**
 * Übersicht für die Administration.
 *
 * Zeigt die Statusverteilung aller Aufträge (offen / in Arbeit / erledigt),
 * die heutigen Einsätze und die nächsten anstehenden Termine.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ordersApi } from '../api/client';
import type { OrderListItem, OrderStats, OrderStatus } from '../api/types';
import { PageHeader } from '../components/Layout';
import { OrderCard } from '../components/OrderCard';
import { EmptyState, ErrorMessage, Loading } from '../components/ui';
import { STATUS_ICON, IconOrders, IconPlus } from '../components/Icons';
import { STATUS_COLOR, STATUS_LABEL } from '../utils/labels';
import { today } from '../utils/date';
import './pages.css';

/** Diese drei Kacheln stehen im Vordergrund; "storniert" wird nur klein ergänzt. */
const MAIN_STATUSES: OrderStatus[] = ['OFFEN', 'IN_ARBEIT', 'ERLEDIGT'];

export function DashboardPage() {
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [todayOrders, setTodayOrders] = useState<OrderListItem[]>([]);
  const [upcoming, setUpcoming] = useState<OrderListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      ordersApi.stats(),
      ordersApi.list({ scope: 'today', today: today() }),
      ordersApi.list({ from: today(), status: 'OFFEN' }),
    ])
      .then(([statsData, todayData, upcomingData]) => {
        setStats(statsData);
        setTodayOrders(todayData);
        // Die nächsten fünf offenen Termine ab heute
        setUpcoming(upcomingData.filter((o) => o.scheduledDate !== today()).slice(0, 5));
      })
      .catch(() => setError('Die Übersicht konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader
        title="Übersicht"
        subtitle="Aktueller Stand aller Aufträge"
        actions={
          <Link to="/auftraege/neu" className="btn">
            <IconPlus size={18} />
            Neuer Auftrag
          </Link>
        }
      />

      <ErrorMessage error={error} />

      {/* ── Kennzahlen ──────────────────────────────────────────────────── */}
      <div className="stat-grid">
        {MAIN_STATUSES.map((status) => {
          const Icon = STATUS_ICON[status];
          return (
            <Link key={status} to={`/auftraege?status=${status}`} className="stat-card">
              <span className="stat-card__icon" style={{ color: STATUS_COLOR[status] }}>
                <Icon size={22} />
              </span>
              <span className="stat-card__value">{stats?.byStatus[status] ?? 0}</span>
              <span className="stat-card__label">{STATUS_LABEL[status]}</span>
            </Link>
          );
        })}
        <Link to="/auftraege" className="stat-card">
          <span className="stat-card__icon" style={{ color: 'var(--navy)' }}>
            <IconOrders size={22} />
          </span>
          <span className="stat-card__value">{stats?.total ?? 0}</span>
          <span className="stat-card__label">Gesamt</span>
        </Link>
      </div>

      {(stats?.byStatus.STORNIERT ?? 0) > 0 && (
        <p className="muted small" style={{ marginTop: -4, marginBottom: 18 }}>
          Zusätzlich {stats?.byStatus.STORNIERT} stornierte{' '}
          {stats?.byStatus.STORNIERT === 1 ? 'Auftrag' : 'Aufträge'}.
        </p>
      )}

      {/* ── Heute ───────────────────────────────────────────────────────── */}
      <section className="section">
        <div className="section__header">
          <h2>Heute im Einsatz</h2>
          <Link to="/dienstplan" className="small">
            Zum Dienstplan
          </Link>
        </div>

        {todayOrders.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<IconOrders size={40} />}
              title="Für heute ist nichts geplant"
              text="Neue Aufträge lassen sich jederzeit anlegen und zuweisen."
            />
          </div>
        ) : (
          <div className="order-list">
            {todayOrders.map((order) => (
              <OrderCard key={order.id} order={order} showAssignees />
            ))}
          </div>
        )}
      </section>

      {/* ── Nächste Termine ─────────────────────────────────────────────── */}
      {upcoming.length > 0 && (
        <section className="section">
          <div className="section__header">
            <h2>Als Nächstes</h2>
            <Link to="/auftraege?status=OFFEN" className="small">
              Alle offenen Aufträge
            </Link>
          </div>
          <div className="order-list">
            {upcoming.map((order) => (
              <OrderCard key={order.id} order={order} showAssignees />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
