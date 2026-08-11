/**
 * Auftragsliste der Administration mit Suche und Filtern.
 *
 * Filter: Status, Auftragsart, Mitarbeiter, Zeitraum, Freitextsuche
 * (Kundenname, Adresse, Notizen, Auftragsnummer).
 *
 * Die gewählten Filter stehen im URL-Parameter – so lässt sich eine gefilterte
 * Ansicht als Lesezeichen speichern oder weitergeben (z. B. /auftraege?status=OFFEN).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ordersApi, usersApi } from '../api/client';
import type { AssignableUser, OrderListItem } from '../api/types';
import { PageHeader } from '../components/Layout';
import { OrderCard } from '../components/OrderCard';
import { EmptyState, ErrorMessage, Loading } from '../components/ui';
import { IconFilter, IconOrders, IconPlus, IconSearch } from '../components/Icons';
import { ORDER_STATUSES, ORDER_TYPES, STATUS_LABEL, TYPE_LABEL } from '../utils/labels';
import './pages.css';

export function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [employees, setEmployees] = useState<AssignableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Freitextsuche wird verzögert an den Server geschickt (siehe useEffect unten)
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '');

  /** Aktuelle Filter aus der URL. */
  const filters = useMemo(
    () => ({
      status: searchParams.get('status') ?? '',
      type: searchParams.get('type') ?? '',
      employeeId: searchParams.get('employeeId') ?? '',
      from: searchParams.get('from') ?? '',
      to: searchParams.get('to') ?? '',
      q: searchParams.get('q') ?? '',
    }),
    [searchParams]
  );

  const activeFilterCount = [
    filters.status,
    filters.type,
    filters.employeeId,
    filters.from,
    filters.to,
  ].filter(Boolean).length;

  /** Setzt einen einzelnen Filter (leerer Wert entfernt ihn). */
  const setFilter = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set(key, value);
      else next.delete(key);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  // Mitarbeiterliste für den Filter einmalig laden
  useEffect(() => {
    usersApi.assignable().then(setEmployees).catch(() => undefined);
  }, []);

  // Suchtext erst 300 ms nach der letzten Eingabe übernehmen (weniger Anfragen)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== filters.q) setFilter('q', searchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, filters.q, setFilter]);

  // Aufträge bei jeder Filteränderung neu laden
  useEffect(() => {
    setLoading(true);
    ordersApi
      .list(filters)
      .then(setOrders)
      .catch(() => setError('Die Aufträge konnten nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, [filters]);

  const resetFilters = () => {
    setSearchInput('');
    setSearchParams({}, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Aufträge"
        subtitle={loading ? 'Wird geladen …' : `${orders.length} Aufträge gefunden`}
        actions={
          <Link to="/auftraege/neu" className="btn">
            <IconPlus size={18} />
            Neuer Auftrag
          </Link>
        }
      />

      <ErrorMessage error={error} />

      {/* ── Suche und Filter ────────────────────────────────────────────── */}
      <div className="card filter-bar">
        <div className="filter-bar__search">
          <span className="filter-bar__search-icon">
            <IconSearch size={18} />
          </span>
          <input
            className="input"
            type="search"
            placeholder="Kunde, Adresse, Notiz oder Auftragsnummer …"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            aria-label="Aufträge durchsuchen"
          />
          <button
            type="button"
            className={`btn btn--ghost filter-bar__toggle${activeFilterCount ? ' is-active' : ''}`}
            onClick={() => setShowFilters((value) => !value)}
            aria-expanded={showFilters}
          >
            <IconFilter size={18} />
            <span className="hide-mobile">Filter</span>
            {activeFilterCount > 0 && <span className="filter-bar__count">{activeFilterCount}</span>}
          </button>
        </div>

        {showFilters && (
          <div className="filter-bar__fields">
            <div className="field">
              <label htmlFor="f-status">Status</label>
              <select
                id="f-status"
                className="select"
                value={filters.status}
                onChange={(event) => setFilter('status', event.target.value)}
              >
                <option value="">Alle</option>
                {ORDER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="f-type">Auftragsart</label>
              <select
                id="f-type"
                className="select"
                value={filters.type}
                onChange={(event) => setFilter('type', event.target.value)}
              >
                <option value="">Alle</option>
                {ORDER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="f-employee">Mitarbeiter</label>
              <select
                id="f-employee"
                className="select"
                value={filters.employeeId}
                onChange={(event) => setFilter('employeeId', event.target.value)}
              >
                <option value="">Alle</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="f-from">Termin von</label>
              <input
                id="f-from"
                className="input"
                type="date"
                value={filters.from}
                onChange={(event) => setFilter('from', event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="f-to">Termin bis</label>
              <input
                id="f-to"
                className="input"
                type="date"
                value={filters.to}
                onChange={(event) => setFilter('to', event.target.value)}
              />
            </div>

            <div className="field filter-bar__reset">
              <button type="button" className="btn btn--ghost btn--block" onClick={resetFilters}>
                Filter zurücksetzen
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Ergebnisliste ───────────────────────────────────────────────── */}
      {loading ? (
        <Loading />
      ) : orders.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconOrders size={40} />}
            title="Keine Aufträge gefunden"
            text={
              activeFilterCount || filters.q
                ? 'Für diese Filter gibt es keine Treffer. Filter anpassen oder zurücksetzen.'
                : 'Lege den ersten Auftrag an.'
            }
            action={
              activeFilterCount || filters.q ? (
                <button type="button" className="btn btn--ghost" onClick={resetFilters}>
                  Filter zurücksetzen
                </button>
              ) : (
                <Link to="/auftraege/neu" className="btn">
                  <IconPlus size={18} />
                  Neuer Auftrag
                </Link>
              )
            }
          />
        </div>
      ) : (
        <div className="order-list">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} showAssignees />
          ))}
        </div>
      )}
    </>
  );
}
