/**
 * Deutsche Beschriftungen und Farben für Status und Auftragsarten.
 * Zentral gepflegt, damit Listen, Detailansicht und Dienstplan identisch aussehen.
 */
import type { OrderStatus, OrderType } from '../api/types';

export const ORDER_STATUSES: OrderStatus[] = ['OFFEN', 'IN_ARBEIT', 'ERLEDIGT', 'STORNIERT'];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  OFFEN: 'Offen',
  IN_ARBEIT: 'In Arbeit',
  ERLEDIGT: 'Erledigt',
  STORNIERT: 'Storniert',
};

/** Farbe für Balken, Punkte und Kalendereinträge. */
export const STATUS_COLOR: Record<OrderStatus, string> = {
  OFFEN: 'var(--status-open)',
  IN_ARBEIT: 'var(--status-progress)',
  ERLEDIGT: 'var(--status-done)',
  STORNIERT: 'var(--status-cancelled)',
};

export const ORDER_TYPES: OrderType[] = [
  'REINIGUNG',
  'GARTEN',
  'ABRISS',
  'WINTERDIENST',
  'ENTRUEMPELUNG',
];

export const TYPE_LABEL: Record<OrderType, string> = {
  REINIGUNG: 'Reinigung',
  GARTEN: 'Garten',
  ABRISS: 'Abriss',
  WINTERDIENST: 'Winterdienst',
  ENTRUEMPELUNG: 'Entrümpelung',
};

export const TYPE_COLOR: Record<OrderType, string> = {
  REINIGUNG: 'var(--type-reinigung)',
  GARTEN: 'var(--type-garten)',
  ABRISS: 'var(--type-abriss)',
  WINTERDIENST: 'var(--type-winterdienst)',
  ENTRUEMPELUNG: 'var(--type-entruempelung)',
};

/**
 * Vorschläge für die Unterart je Auftragsart (z. B. "Grundreinigung" bei
 * Reinigung). Reine Komfort-Vorschläge im Formular – das Feld selbst ist
 * frei befüllbar, neue Unterarten brauchen also keine Code-Änderung.
 */
export const ORDER_SUBTYPE_SUGGESTIONS: Record<OrderType, string[]> = {
  REINIGUNG: [
    'Unterhaltsreinigung',
    'Grundreinigung',
    'Bauendreinigung',
    'Fensterreinigung',
    'Treppenhausreinigung',
    'Büroreinigung',
  ],
  GARTEN: ['Rasenmähen', 'Heckenschnitt', 'Laubentfernung', 'Neuanlage', 'Grünschnitt'],
  ABRISS: ['Entkernung', 'Komplettabriss', 'Schadstoffsanierung'],
  WINTERDIENST: ['Räumdienst', 'Streudienst'],
  ENTRUEMPELUNG: ['Haushaltsauflösung', 'Kellerentrümpelung', 'Gewerbeentrümpelung'],
};

export const WEEKDAY_LABEL_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/**
 * Nächster Status im normalen Arbeitsablauf.
 * offen → in Arbeit → erledigt. Danach gibt es keinen Folgeschritt mehr.
 */
export function nextStatus(status: OrderStatus): OrderStatus | null {
  if (status === 'OFFEN') return 'IN_ARBEIT';
  if (status === 'IN_ARBEIT') return 'ERLEDIGT';
  return null;
}

/** Beschriftung des Buttons für den nächsten Arbeitsschritt. */
export function nextStatusLabel(status: OrderStatus): string | null {
  if (status === 'OFFEN') return 'Arbeit beginnen';
  if (status === 'IN_ARBEIT') return 'Als erledigt melden';
  return null;
}
