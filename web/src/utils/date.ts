/**
 * Datums- und Zeit-Helfer – durchgängig in deutschem Format
 * und mit Montag als erstem Wochentag.
 */

/** Datum als 'YYYY-MM-DD' in lokaler Zeit (nicht UTC – sonst Tagesverschiebung). */
export function toISODate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Heutiges Datum als 'YYYY-MM-DD'. */
export function today(): string {
  return toISODate(new Date());
}

/** '2026-08-11' → Date (12:00 Uhr, um Zeitzonen-Effekte zu vermeiden) */
export function parseISODate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

/** '2026-08-11' → '11.08.2026' */
export function formatDate(value: string | null): string {
  if (!value) return '—';
  return parseISODate(value).toLocaleDateString('de-DE');
}

/** '2026-08-11' → 'Di, 11.08.' */
export function formatDateShort(value: string | null): string {
  if (!value) return '—';
  return parseISODate(value).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

/** ISO-Zeitstempel → '11.08.2026, 09:30' */
export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Zeitfenster als '08:00 – 11:00' bzw. 'ab 08:00'. */
export function formatTimeRange(start: string | null, end: string | null): string {
  if (start && end) return `${start} – ${end} Uhr`;
  if (start) return `ab ${start} Uhr`;
  if (end) return `bis ${end} Uhr`;
  return 'ganztägig';
}

/** Montag der Woche, in der das Datum liegt. */
export function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const weekday = (result.getDay() + 6) % 7; // Montag = 0
  result.setDate(result.getDate() - weekday);
  result.setHours(12, 0, 0, 0);
  return result;
}

/** Alle 7 Tage einer Woche ab Montag. */
export function weekDays(reference: Date): Date[] {
  const monday = startOfWeek(reference);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/**
 * Alle Tage eines Monatsrasters (immer volle Wochen von Montag bis Sonntag),
 * damit der Kalender ein gleichmäßiges Gitter ergibt.
 */
export function monthGridDays(reference: Date): Date[] {
  const first = new Date(reference.getFullYear(), reference.getMonth(), 1, 12);
  const last = new Date(reference.getFullYear(), reference.getMonth() + 1, 0, 12);
  const start = startOfWeek(first);
  const days: Date[] = [];
  for (let day = new Date(start); day <= last || days.length % 7 !== 0; day = addDays(day, 1)) {
    days.push(new Date(day));
    if (days.length > 42) break; // Sicherheitsnetz
  }
  return days;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  result.setHours(12, 0, 0, 0);
  return result;
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1, 12);
}

export const WEEKDAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** 'August 2026' */
export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

/** 'KW 33 · 10.08. – 16.08.2026' */
export function formatWeekRange(date: Date): string {
  const monday = startOfWeek(date);
  const sunday = addDays(monday, 6);
  const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' };
  return `KW ${isoWeekNumber(monday)} · ${monday.toLocaleDateString('de-DE', options)} – ${sunday.toLocaleDateString('de-DE', { ...options, year: 'numeric' })}`;
}

/** Kalenderwoche nach ISO 8601. */
export function isoWeekNumber(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
}

export function isToday(date: Date): boolean {
  return toISODate(date) === today();
}

export function isSameMonth(date: Date, reference: Date): boolean {
  return date.getMonth() === reference.getMonth() && date.getFullYear() === reference.getFullYear();
}

/**
 * Link zur Navigation in Google Maps.
 * Funktioniert auf dem Smartphone direkt mit der Maps-App.
 */
export function mapsLink(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
