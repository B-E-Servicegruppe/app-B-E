/**
 * Kunden-/Objektverwaltung (nur Administration).
 *
 * Reine Komfortfunktion: Kunden hier anlegen, damit sie beim Erstellen eines
 * Auftrags per Klick ausgewählt werden können, statt Name/Adresse/Telefon
 * jedes Mal neu einzutippen.
 */
import { useEffect, useState } from 'react';
import { ApiError, customersApi } from '../api/client';
import type { Customer } from '../api/types';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, EmptyState, ErrorMessage, Loading, Modal, Toast } from '../components/ui';
import { IconMapPin, IconPlus, IconTrash } from '../components/Icons';
import './pages.css';

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    customersApi
      .list()
      .then(setCustomers)
      .catch(() => setError('Die Kundenliste konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await customersApi.remove(confirmDelete.id);
      setCustomers((current) => current.filter((c) => c.id !== confirmDelete.id));
      setToast('Kunde gelöscht');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Löschen nicht möglich.');
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  };

  const filtered = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || (c.address ?? '').toLowerCase().includes(q);
  });

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader
        title="Kunden & Objekte"
        subtitle={`${customers.length} gespeichert`}
        actions={
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            <IconPlus size={18} />
            Neuer Kunde
          </button>
        }
      />

      <ErrorMessage error={error} />

      {customers.length > 0 && (
        <input
          className="input"
          style={{ marginBottom: 16, maxWidth: 420 }}
          placeholder="Kunde oder Adresse suchen …"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}

      {customers.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconMapPin size={40} />}
            title="Noch keine Kunden gespeichert"
            text="Lege Kunden oder Objekte an, um sie beim Anlegen eines Auftrags per Klick auszuwählen, statt die Daten jedes Mal neu einzutippen."
          />
        </div>
      ) : (
        <div className="user-list">
          {filtered.map((customer) => (
            <div key={customer.id} className="card user-card">
              <div className="card__body">
                <div className="user-card__top">
                  <span className="user-card__avatar">
                    <IconMapPin size={20} />
                  </span>
                  <div className="user-card__identity">
                    <h3>{customer.name}</h3>
                    {customer.address && <span className="muted small">{customer.address}</span>}
                  </div>
                  {customer.orderCount > 0 && (
                    <span className="chip chip--type">
                      {customer.orderCount} Auftrag{customer.orderCount === 1 ? '' : 'ä + e'}
                    </span>
                  )}
                </div>

                <div className="user-card__meta">
                  {customer.contactPhone && (
                    <span className="muted small">{customer.contactPhone}</span>
                  )}
                  {customer.notes && <span className="muted small">{customer.notes}</span>}
                </div>

                <div className="user-card__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setEditing(customer)}
                  >
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setConfirmDelete(customer)}
                  >
                    <IconTrash size={15} />
                    Löschen
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <CustomerDialog
          customer={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(message) => {
            setCreating(false);
            setEditing(null);
            setToast(message);
            load();
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Kunde löschen?"
        message={`${confirmDelete?.name} wird endgültig entfernt. Das ist nur möglich, solange kein Auftrag mehr mit diesem Kunden verknüpft ist.`}
        confirmLabel="Löschen"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(null)}
      />

      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
/** Dialog zum Anlegen und Bearbeiten eines Kunden. */
function CustomerDialog({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(customer?.name ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [contactPhone, setContactPhone] = useState(customer?.contactPhone ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const input = {
        name: name.trim(),
        address: address.trim() || null,
        contactPhone: contactPhone.trim() || null,
        notes: notes.trim() || null,
      };
      if (customer) {
        await customersApi.update(customer.id, input);
        onSaved('Kunde gespeichert');
      } else {
        await customersApi.create(input);
        onSaved('Kunde angelegt');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern nicht möglich.');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={customer ? 'Kunde bearbeiten' : 'Neuer Kunde'}
      onClose={onClose}
      footer={
        <>
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
        <label htmlFor="c-name">Name *</label>
        <input
          id="c-name"
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="c-address">Adresse</label>
        <input
          id="c-address"
          className="input"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="Straße Hausnummer, PLZ Ort"
        />
      </div>

      <div className="field">
        <label htmlFor="c-phone">Telefon</label>
        <input
          id="c-phone"
          className="input"
          type="tel"
          value={contactPhone}
          onChange={(event) => setContactPhone(event.target.value)}
        />
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="c-notes">Notizen</label>
        <textarea
          id="c-notes"
          className="textarea"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Besonderheiten, Zufahrt, Ansprechpartner …"
        />
      </div>
    </Modal>
  );
}
