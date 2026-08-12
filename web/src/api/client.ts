/**
 * Zentraler Zugriff auf die REST-API.
 *
 * Alle Anfragen laufen über diese Datei. Vorteile:
 *   - Das Anmelde-Token wird an genau einer Stelle gesetzt.
 *   - Läuft die Sitzung ab (401), wird der Benutzer automatisch abgemeldet.
 *   - Fehlermeldungen des Servers kommen einheitlich als ApiError an.
 *
 * FÜR DIE SPÄTERE APP-STORE-VERSION (Capacitor/React Native):
 * Dort gibt es keinen Vite-Proxy. Dann beim Build die Umgebungsvariable
 * VITE_API_URL auf die Serveradresse setzen, z. B.
 *   VITE_API_URL=https://api.meine-domain.de npm run build
 */
import type {
  AssignableUser,
  OrderDetail,
  OrderFile,
  OrderInput,
  OrderListItem,
  OrderStats,
  OrderStatus,
  Material,
  OrderComment,
  Shift,
  StatusHistoryEntry,
  User,
} from './types';

/** Basisadresse der API (leer = gleiche Herkunft, über den Vite-Proxy). */
const BASE_URL = import.meta.env.VITE_API_URL ?? '';

const TOKEN_KEY = 'be-service.token';

/** Fehler mit Statuscode und – falls vorhanden – Feldhinweisen. */
export class ApiError extends Error {
  status: number;
  details?: { field: string; message: string }[];

  constructor(status: number, message: string, details?: { field: string; message: string }[]) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// ── Token-Verwaltung ────────────────────────────────────────────────────────
export const tokenStore = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** Wird gesetzt, damit der Auth-Context auf abgelaufene Sitzungen reagieren kann. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

// ── Basisfunktion ───────────────────────────────────────────────────────────
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-Körper (wird automatisch serialisiert) */
  body?: unknown;
  /** FormData für Datei-Uploads (dann kein JSON-Header setzen!) */
  formData?: FormData;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData } = options;
  const headers: Record<string, string> = {};

  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });

  // Sitzung abgelaufen oder Token ungültig → abmelden.
  // Ausnahme: die Anmeldung selbst. Dort bedeutet 401 nur "Zugangsdaten falsch"
  // und darf eine bestehende Sitzung nicht beenden.
  if (response.status === 401 && !path.startsWith('/api/auth/login')) {
    tokenStore.clear();
    onUnauthorized?.();
  }

  let data: unknown = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) data = await response.json();

  if (!response.ok) {
    const payload = data as { error?: string; details?: { field: string; message: string }[] };
    throw new ApiError(
      response.status,
      payload?.error || 'Die Anfrage konnte nicht ausgeführt werden.',
      payload?.details
    );
  }

  return data as T;
}

/** Baut einen Query-String aus definierten Werten (leere Werte entfallen). */
function query(params: Record<string, string | number | undefined | null> | OrderFilters): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

// ── Anmeldung ───────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  me: () => request<{ user: User }>('/api/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),

  updatePrivateEmail: (privateEmail: string) =>
    request<{ user: User }>('/api/auth/private-email', {
      method: 'PUT',
      body: { privateEmail },
    }),

  forgotPassword: (email: string) =>
    request<{ ok: true; message: string; devResetUrl?: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: { email },
    }),

  resetPassword: (token: string, newPassword: string) =>
    request<{ ok: true }>('/api/auth/reset-password', {
      method: 'POST',
      body: { token, newPassword },
    }),
};

// ── Aufträge ────────────────────────────────────────────────────────────────
export interface OrderFilters {
  status?: string;
  type?: string;
  employeeId?: number | string;
  from?: string;
  to?: string;
  /** Kurzform für die Tabs "Heute"/"Diese Woche" */
  scope?: 'today' | 'week';
  /** heutiges Datum aus Sicht des Geräts (für korrekte Zeitzone) */
  today?: string;
  q?: string;
}

export const ordersApi = {
  list: (filters: OrderFilters = {}) =>
    request<{ orders: OrderListItem[] }>(`/api/orders${query(filters)}`).then((r) => r.orders),

  get: (id: number) => request<{ order: OrderDetail }>(`/api/orders/${id}`).then((r) => r.order),

  stats: () => request<OrderStats>('/api/orders/stats/summary'),

  /**
   * Anlegen. Sind Dateien dabei, wird multipart/form-data verwendet –
   * Listenfelder werden dann als JSON-Text übertragen.
   */
  create: (input: OrderInput, files: File[] = []) => {
    if (files.length === 0) {
      return request<{ order: OrderListItem }>('/api/orders', {
        method: 'POST',
        body: input,
      }).then((r) => r.order);
    }
    return request<{ order: OrderListItem }>('/api/orders', {
      method: 'POST',
      formData: buildOrderFormData(input, files),
    }).then((r) => r.order);
  },

  update: (id: number, input: OrderInput, files: File[] = []) => {
    if (files.length === 0) {
      return request<{ order: OrderListItem }>(`/api/orders/${id}`, {
        method: 'PUT',
        body: input,
      }).then((r) => r.order);
    }
    return request<{ order: OrderListItem }>(`/api/orders/${id}`, {
      method: 'PUT',
      formData: buildOrderFormData(input, files),
    }).then((r) => r.order);
  },

  remove: (id: number) => request<{ ok: true }>(`/api/orders/${id}`, { method: 'DELETE' }),

  duplicate: (id: number) =>
    request<{ order: OrderListItem }>(`/api/orders/${id}/duplicate`, { method: 'POST' }).then(
      (r) => r.order
    ),

  setStatus: (id: number, status: OrderStatus) =>
    request<{ status: OrderStatus; history: StatusHistoryEntry[] }>(`/api/orders/${id}/status`, {
      method: 'PATCH',
      body: { status },
    }),

  toggleMaterial: (orderId: number, materialId: number, done: boolean) =>
    request<{ materials: Material[] }>(`/api/orders/${orderId}/materials/${materialId}`, {
      method: 'PATCH',
      body: { done },
    }).then((r) => r.materials),

  addComment: (orderId: number, body: string) =>
    request<{ comments: OrderComment[] }>(`/api/orders/${orderId}/comments`, {
      method: 'POST',
      body: { body },
    }).then((r) => r.comments),

  uploadFiles: (orderId: number, files: File[], kind?: 'ATTACHMENT' | 'PROOF_PHOTO') => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    if (kind) formData.append('kind', kind);
    return request<{ files: OrderFile[] }>(`/api/orders/${orderId}/files`, {
      method: 'POST',
      formData,
    }).then((r) => r.files);
  },

  removeFile: (orderId: number, fileId: number) =>
    request<{ files: OrderFile[] }>(`/api/orders/${orderId}/files/${fileId}`, {
      method: 'DELETE',
    }).then((r) => r.files),
};

/** Baut das multipart-Formular für Auftrag + Dateien. */
function buildOrderFormData(input: OrderInput, files: File[]): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    // Listen (Material, Zuweisungen) als JSON übertragen
    formData.append(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
  }
  files.forEach((file) => formData.append('files', file));
  return formData;
}

// ── Dienstplan ──────────────────────────────────────────────────────────────
export interface ShiftInput {
  userId: number;
  orderId?: number | null;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  title?: string | null;
  note?: string | null;
}

export const shiftsApi = {
  list: (from: string, to: string, userId?: number) =>
    request<{ shifts: Shift[] }>(`/api/shifts${query({ from, to, userId })}`).then((r) => r.shifts),

  create: (input: ShiftInput) =>
    request<{ shift: Shift }>('/api/shifts', { method: 'POST', body: input }).then((r) => r.shift),

  update: (id: number, input: ShiftInput) =>
    request<{ shift: Shift }>(`/api/shifts/${id}`, { method: 'PUT', body: input }).then(
      (r) => r.shift
    ),

  /** Verschieben per Drag & Drop */
  move: (id: number, date: string, userId?: number) =>
    request<{ shift: Shift }>(`/api/shifts/${id}/move`, {
      method: 'PATCH',
      body: { date, ...(userId ? { userId } : {}) },
    }).then((r) => r.shift),

  remove: (id: number) => request<{ ok: true }>(`/api/shifts/${id}`, { method: 'DELETE' }),
};

// ── Benutzer ────────────────────────────────────────────────────────────────
export const usersApi = {
  list: () => request<{ users: User[] }>('/api/users').then((r) => r.users),

  assignable: () =>
    request<{ users: AssignableUser[] }>('/api/users/assignable').then((r) => r.users),

  create: (input: { name: string; email: string; phone?: string; role: 'ADMIN' | 'EMPLOYEE'; password?: string }) =>
    request<{ user: User; initialPassword: string }>('/api/users', { method: 'POST', body: input }),

  update: (id: number, input: { name: string; email: string; phone?: string; role: 'ADMIN' | 'EMPLOYEE' }) =>
    request<{ user: User }>(`/api/users/${id}`, { method: 'PUT', body: input }).then((r) => r.user),

  setActive: (id: number, active: boolean) =>
    request<{ user: User }>(`/api/users/${id}/active`, { method: 'PATCH', body: { active } }).then(
      (r) => r.user
    ),

  resetPassword: (id: number, password?: string) =>
    request<{ initialPassword: string }>(`/api/users/${id}/password`, {
      method: 'POST',
      body: password ? { password } : {},
    }),
};
