/**
 * "Meine Aufträge" – Startseite für Mitarbeiter.
 *
 * Drei Tabs: Heute / Diese Woche / Alle.
 * Die Einschränkung auf die eigenen Aufträge nimmt der Server vor; hier wird
 * lediglich der Zeitraum gefiltert. Ruft ein Admin die Seite auf, sieht er
 * die ihm selbst zugewiesenen Aufträge (in der Regel keine) – für den
 * Gesamtüberblick gibt es die Auftragsverwaltung.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ordersApi } from '../api/client';
import type { OrderListItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { OrderCard } from '../components/OrderCard';
import { EmptyState, ErrorMessage, Loading } from '../components/ui';
import { IconOrders } from '../components/Icons';
import { today } from '../utils/date';
import './pages.css';

type Tab = 'today' | 'week' | 'all';

const TABS: { key: Tab; label: string }[] = [
  { key: 'today', label: 'Heute' },
  { key: 'week', label: 'Diese Woche' },
  { key: 'all', label: 'Alle' },
];

export function MyOrdersPage() {
  const { user, isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>('today');
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    ordersApi
      // scope=today|week wird serverseitig in einen Datumsbereich übersetzt;
      // "today" schickt das Gerätedatum mit, damit die Zeitzone stimmt.
      .list(tab === 'all' ? {} : { scope: tab, today: today() })
      .then(setOrders)
      .catch(() => setError('Deine Aufträge konnten nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, [tab]);

  // Erledigte und stornierte Aufträge nach unten sortieren
  const sorted = [...orders].sort((a, b) => {
    const rank = (status: string) => (status === 'ERLEDIGT' || status === 'STORNIERT' ? 1 : 0);
    return rank(a.status) - rank(b.status);
  });

  const openCount = orders.filter((o) => o.status === 'OFFEN' || o.status === 'IN_ARBEIT').length;

  return (
    <>
      <PageHeader
        title={`Hallo ${user?.name?.split(' ')[0] ?? ''}`}
        subtitle={
          loading
            ? 'Wird geladen …'
            : openCount === 0
              ? 'Aktuell nichts offen'
              : `${openCount} ${openCount === 1 ? 'Auftrag' : 'Aufträge'} zu erledigen`
        }
      />

      {isAdmin && (
        <div className="alert alert--info">
          Diese Ansicht zeigt nur die dir persönlich zugewiesenen Aufträge.{' '}
          <Link to="/auftraege">Zur vollständigen Auftragsverwaltung</Link>
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`tabs__item${tab === item.key ? ' is-active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <ErrorMessage error={error} />

      {loading ? (
        <Loading />
      ) : sorted.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconOrders size={40} />}
            title={
              tab === 'today'
                ? 'Heute steht nichts an'
                : tab === 'week'
                  ? 'Diese Woche ist nichts geplant'
                  : 'Dir sind noch keine Aufträge zugewiesen'
            }
            text="Sobald dir die Administration einen Auftrag zuweist, erscheint er hier."
          />
        </div>
      ) : (
        <div className="order-list">
          {sorted.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </>
  );
}
