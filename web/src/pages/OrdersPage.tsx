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
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ApiError, ordersApi, orderSeriesApi, usersApi } from '../api/client';
import type { AssignableUser, OrderListItem, OrderSeries } from '../api/types';
import { PageHeader } from '../components/Layout';
import { OrderCard } from '../components/OrderCard';
import { ConfirmDialog, EmptyState, ErrorMessage, Loading, Toast } from '../components/ui';
import {
  IconChevronLeft,
  IconFilter,
  IconOrders,
  IconPlus,
  IconRepeat,
  IconSearch,
  IconTrash,
} from '../components/Icons';
import { ORDER_STATUSES, ORDER_TYPES, STATUS_LABEL, TYPE_LABEL } from '../utils/labels';
import './pages.css';

export function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [employees, setEmployees] = useState<AssignableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  // Sammel-Löschen: Mehrfachauswahl einzelner (nicht gruppierter) Aufträge
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Meldung z. B. nach dem Anlegen eines wiederkehrenden Auftrags
  const [toast, setToast] = useState<string | null>(
    (location.state as { toast?: string } | null)?.toast ?? null
  );

  // Ist eine bestimmte Serie ausgewählt (Klick auf eine Serien-Karte), zeigen
  // wir statt der normalen gruppierten Liste alle ihre Einzeltermine.
  const seriesId = searchParams.get('seriesId');
  const [seriesInfo, setSeriesInfo] = useState<OrderSeries | null>(null);
  const [seriesBusy, setSeriesBusy] = useState(false);

  useEffect(() => {
    if (!seriesId) {
      setSeriesInfo(null);
      return;
    }
    orderSeriesApi.get(Number(seriesId)).then(setSeriesInfo).catch(() => setSeriesInfo(null));
  }, [seriesId]);

  const extendSeries = async () => {
    if (!seriesId) return;
    setSeriesBusy(true);
    try {
      const result = await orderSeriesApi.extend(Number(seriesId));
      setSeriesInfo(result.series);
      setToast(
        result.createdOrders > 0
          ? `${result.createdOrders} weitere Termine wurden angelegt.`
          : 'Für den erweiterten Zeitraum ergab sich kein neuer Termin.'
      );
      setLoading(true);
      ordersApi.list({ seriesId: Number(seriesId) }).then(setOrders).finally(() => setLoading(false));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verlängern nicht möglich.');
    } finally {
      setSeriesBusy(false);
    }
  };

  const endSeries = async () => {
    if (!seriesId) return;
    if (!confirm('Serie beenden? Noch offene, zukünftige Termine werden storniert. Bereits erledigte oder laufende bleiben erhalten.')) {
      return;
    }
    setSeriesBusy(true);
    try {
      await orderSeriesApi.remove(Number(seriesId));
      setToast('Serie beendet.');
      setSeriesInfo((info) => (info ? { ...info, openEnded: false } : info));
      setLoading(true);
      ordersApi.list({ seriesId: Number(seriesId) }).then(setOrders).finally(() => setLoading(false));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Serie konnte nicht beendet werden.');
    } finally {
      setSeriesBusy(false);
    }
  };

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
      seriesId: seriesId ? Number(seriesId) : undefined,
      // Ohne aktive Serienauswahl fassen wir wiederkehrende Aufträge zu einer
      // Karte zusammen; bei einer ausgewählten Serie wollen wir ja gerade
      // ALLE ihre Termine einzeln sehen (das macht der Server automatisch,
      // group wird dann serverseitig ignoriert – schadet aber nicht).
      group: 'series' as const,
    }),
    [searchParams, seriesId]
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

  const toggleSelect = (id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const bulkDelete = async () => {
    setBulkBusy(true);
    try {
      const result = await ordersApi.bulkDelete([...selectedIds]);
      setToast(`${result.deleted} Aufträge gelöscht.`);
      exitSelectMode();
      setLoading(true);
      ordersApi.list(filters).then(setOrders).finally(() => setLoading(false));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen nicht möglich.');
    } finally {
      setBulkBusy(false);
      setConfirmBulkDelete(false);
    }
  };

  return (
    <>
      {seriesId ? (
        <PageHeader
          title={seriesInfo ? `Serie: ${seriesInfo.customerName}` : 'Serie: alle Termine'}
          subtitle={loading ? 'Wird geladen …' : `${orders.length} Termine`}
          actions={
            <Link to="/auftraege" className="btn btn--ghost">
              <IconChevronLeft size={18} />
              Zu allen Aufträgen
            </Link>
          }
        />
      ) : (
        <PageHeader
          title="Aufträge"
          subtitle={loading ? 'Wird geladen …' : `${orders.length} Aufträge gefunden`}
          actions={
            selectMode ? (
              <button type="button" className="btn btn--ghost" onClick={exitSelectMode}>
                Auswahl beenden
              </button>
            ) : (
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn--ghost" onClick={() => setSelectMode(true)}>
                  Auswählen
                </button>
                <Link to="/auftraege/neu" className="btn">
                  <IconPlus size={18} />
                  Neuer Auftrag
                </Link>
              </div>
            )
          }
        />
      )}

      {selectMode && (
        <div className="card" style={{ marginBottom: 16, position: 'sticky', top: 8, zIndex: 5 }}>
          <div className="card__body row row--wrap" style={{ alignItems: 'center', gap: 12 }}>
            <span>{selectedIds.size} ausgewählt</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setConfirmBulkDelete(true)}
                disabled={selectedIds.size === 0}
              >
                <IconTrash size={15} />
                Ausgewählte löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {seriesId && seriesInfo && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__body row row--wrap" style={{ alignItems: 'center', gap: 12 }}>
            <span className="chip chip--type">
              <IconRepeat size={13} /> {seriesInfo.openEnded ? 'Läuft ohne Enddatum' : 'Läuft bis ' + seriesInfo.endDate}
            </span>
            <span className="muted small">{seriesInfo.address}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {seriesInfo.openEnded && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={extendSeries} disabled={seriesBusy}>
                  Weitere Termine anlegen
                </button>
              )}
              <button type="button" className="btn btn--ghost btn--sm" onClick={endSeries} disabled={seriesBusy}>
                Serie beenden
              </button>
            </div>
          </div>
        </div>
      )}

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
            <OrderCard
              key={order.id}
              order={order}
              showAssignees
              selectable={selectMode}
              selected={selectedIds.has(order.id)}
              onToggleSelect={toggleSelect}
              linkToDetail={Boolean(seriesId)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Ausgewählte Aufträge löschen?"
        message={`${selectedIds.size} Aufträge werden endgültig gelöscht, inklusive zugehöriger Dienstplan-Einträge und Dateien. Das lässt sich nicht rückgängig machen.`}
        confirmLabel="Löschen"
        danger
        busy={bulkBusy}
        onConfirm={bulkDelete}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
