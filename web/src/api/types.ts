/**
 * Gemeinsame Datentypen des Frontends.
 * Sie spiegeln exakt die Antworten der REST-API wider (siehe server/src/routes).
 */

export type Role = 'ADMIN' | 'EMPLOYEE';

export type OrderStatus = 'OFFEN' | 'IN_ARBEIT' | 'ERLEDIGT' | 'STORNIERT';

export type OrderType =
  | 'REINIGUNG'
  | 'GARTEN'
  | 'ABRISS'
  | 'WINTERDIENST'
  | 'ENTRUEMPELUNG';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  /** Für "Passwort vergessen" – unabhängig von der Firmenmail erreichbar. */
  privateEmail: string | null;
  active: boolean;
  mustChangePassword: boolean;
  /** nur in der Mitarbeiterverwaltung enthalten */
  createdAt?: string;
  openOrders?: number;
}

/** Kurzform für Auswahllisten (Zuweisung, Dienstplan) */
export interface AssignableUser {
  id: number;
  name: string;
}

export interface Assignee {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  active: boolean;
}

export interface Material {
  id: number;
  name: string;
  quantity: string | null;
  done: boolean;
}

export interface OrderFile {
  id: number;
  kind: 'ATTACHMENT' | 'PROOF_PHOTO';
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  uploadedById: number | null;
  createdAt: string;
  url: string;
}

export interface StatusHistoryEntry {
  id: number;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedBy: string | null;
  changedAt: string;
}

export interface OrderComment {
  id: number;
  body: string;
  author: string | null;
  authorRole: Role | null;
  createdAt: string;
}

/** Auftrag in Listenansichten */
export interface OrderListItem {
  id: number;
  customerName: string;
  address: string;
  contactPhone: string | null;
  customerId: number | null;
  seriesId: number | null;
  orderType: OrderType;
  status: OrderStatus;
  scheduledDate: string | null;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  assignees: Assignee[];
  materialCount: number;
  fileCount: number;
}

/** Auftrag in der Detailansicht (mit allen Unterdaten) */
export interface OrderDetail extends Omit<OrderListItem, 'materialCount' | 'fileCount'> {
  materials: Material[];
  files: OrderFile[];
  history: StatusHistoryEntry[];
  comments: OrderComment[];
}

export interface Shift {
  id: number;
  userId: number;
  userName: string;
  orderId: number | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string | null;
  note: string | null;
  order: {
    id: number;
    customerName: string;
    address: string;
    orderType: OrderType;
    status: OrderStatus;
  } | null;
}

export interface OrderStats {
  byStatus: Record<OrderStatus, number>;
  total: number;
  today: number;
}

/** Eingabedaten beim Anlegen/Bearbeiten eines Auftrags */
export interface OrderInput {
  customerName: string;
  address: string;
  contactPhone?: string | null;
  /** Verweis auf einen gespeicherten Kunden (siehe CustomersPage) */
  customerId?: number | null;
  orderType: OrderType;
  status?: OrderStatus;
  scheduledDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
  materials?: { name: string; quantity?: string | null; done?: boolean }[];
  assigneeIds?: number[];
}

/** Gespeicherter Kunde/Objekt zur Wiederverwendung beim Anlegen von Aufträgen */
export interface Customer {
  id: number;
  name: string;
  address: string | null;
  contactPhone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Anzahl bisheriger Aufträge für diesen Kunden */
  orderCount: number;
}

export interface CustomerInput {
  name: string;
  address?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
}

export type SeriesInterval = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

/** Vorlage für einen wiederkehrenden Auftrag */
export interface OrderSeries {
  id: number;
  customerId: number | null;
  customerName: string;
  address: string;
  contactPhone: string | null;
  orderType: OrderType;
  notes: string | null;
  intervalType: SeriesInterval;
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  startDate: string;
  endDate: string;
  createdAt: string;
  /** Anzahl der bereits erzeugten Einzeltermine */
  occurrenceCount: number;
}

export interface OrderSeriesInput {
  customerId?: number | null;
  customerName: string;
  address: string;
  contactPhone?: string | null;
  orderType: OrderType;
  notes?: string | null;
  intervalType: SeriesInterval;
  /** 0 = Montag … 6 = Sonntag. Bei MONTHLY nicht nötig. */
  weekday?: number | null;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  assigneeIds?: number[];
}
