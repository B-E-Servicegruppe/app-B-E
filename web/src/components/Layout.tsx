/**
 * Rahmen der App: Kopfzeile mit Logo, Navigation und Abmelden.
 *
 * Mobile:  feste Kopfzeile oben + Tab-Leiste am unteren Rand (daumenfreundlich)
 * Desktop: Kopfzeile oben mit waagerechter Navigation
 *
 * Die Navigationspunkte richten sich nach der Rolle: Mitarbeiter sehen
 * ausschließlich "Meine Aufträge" und "Dienstplan".
 */
import { NavLink, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  IconCalendar,
  IconDashboard,
  IconLogout,
  IconMapPin,
  IconOrders,
  IconTeam,
  IconUser,
} from './Icons';
import './layout.css';

interface NavItem {
  to: string;
  label: string;
  /** Kurzform für die Tab-Leiste auf dem Smartphone */
  shortLabel: string;
  icon: typeof IconOrders;
}

const ADMIN_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Übersicht', shortLabel: 'Übersicht', icon: IconDashboard },
  { to: '/auftraege', label: 'Aufträge', shortLabel: 'Aufträge', icon: IconOrders },
  { to: '/dienstplan', label: 'Dienstplan', shortLabel: 'Plan', icon: IconCalendar },
  { to: '/kunden', label: 'Kunden', shortLabel: 'Kunden', icon: IconMapPin },
  { to: '/mitarbeiter', label: 'Mitarbeiter', shortLabel: 'Team', icon: IconTeam },
];

const EMPLOYEE_NAV: NavItem[] = [
  { to: '/meine-auftraege', label: 'Meine Aufträge', shortLabel: 'Aufträge', icon: IconOrders },
  { to: '/dienstplan', label: 'Mein Dienstplan', shortLabel: 'Plan', icon: IconCalendar },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const navItems = isAdmin ? ADMIN_NAV : EMPLOYEE_NAV;

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app">
      {/* ── Kopfzeile ──────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="app-header__inner">
          {/* Logo auf weißer Fläche, damit die dunkelblauen Anteile auf dem
              navyfarbenen Header sichtbar bleiben */}
          <NavLink to={navItems[0].to} className="app-header__brand" aria-label="Startseite">
            <span className="app-header__logo">
              <img src="/logo.svg" alt="B&E Service Gruppe" />
            </span>
          </NavLink>

          {/* Waagerechte Navigation – nur auf großen Bildschirmen */}
          <nav className="app-nav hide-desktop-none" aria-label="Hauptnavigation">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `app-nav__link${isActive ? ' is-active' : ''}`}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="app-header__user">
            <NavLink to="/profil" className="app-header__profile" title="Mein Konto">
              <IconUser size={18} />
              <span className="app-header__name">{user?.name}</span>
              <span className="app-header__role">
                {isAdmin ? 'Administration' : 'Mitarbeiter'}
              </span>
            </NavLink>
            <button type="button" className="icon-btn" onClick={handleLogout} title="Abmelden">
              <IconLogout size={20} />
              <span className="sr-only">Abmelden</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Inhalt ─────────────────────────────────────────────────────── */}
      <main className="app-main">{children}</main>

      {/* ── Tab-Leiste am unteren Rand (nur Smartphone) ────────────────── */}
      <nav className="tabbar" aria-label="Hauptnavigation">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `tabbar__item${isActive ? ' is-active' : ''}`}
          >
            <item.icon size={22} />
            <span>{item.shortLabel}</span>
          </NavLink>
        ))}
        <NavLink
          to="/profil"
          className={({ isActive }) => `tabbar__item${isActive ? ' is-active' : ''}`}
        >
          <IconUser size={22} />
          <span>Konto</span>
        </NavLink>
      </nav>
    </div>
  );
}

/** Seitenkopf innerhalb des Inhaltsbereichs (Titel + Aktionen). */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted small" style={{ margin: '4px 0 0' }}>{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}
