/**
 * Routing der App inklusive Rollenschutz.
 *
 * Zwei Schutzstufen:
 *   <RequireAuth>  – nur für angemeldete Benutzer
 *   <RequireAdmin> – zusätzlich nur für Administratoren
 *
 * Hinweis: Diese Prüfungen steuern nur die Anzeige. Selbst wenn jemand eine
 * URL direkt aufruft, liefert das Backend keine fremden Daten aus – die
 * verbindliche Prüfung erfolgt dort (server/src/middleware/auth.js).
 */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';

import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordPages';
import { ProfilePage } from './pages/ProfilePage';
import { DashboardPage } from './pages/DashboardPage';
import { OrdersPage } from './pages/OrdersPage';
import { OrderFormPage } from './pages/OrderFormPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { MyOrdersPage } from './pages/MyOrdersPage';
import { SchedulePage } from './pages/SchedulePage';
import { EmployeesPage } from './pages/EmployeesPage';
import { CustomersPage } from './pages/CustomersPage';
import { LeavePage } from './pages/LeavePage';

/** Leitet Nicht-Angemeldete zur Anmeldung (und merkt sich das Ziel). */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading text="Anmeldung wird geprüft …" />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;

  return <Layout>{children}</Layout>;
}

/** Zusätzlich: nur für Administratoren. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading text="Anmeldung wird geprüft …" />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  // Mitarbeiter landen auf ihrer eigenen Startseite statt auf einer Fehlerseite
  if (user.role !== 'ADMIN') return <Navigate to="/meine-auftraege" replace />;

  return <Layout>{children}</Layout>;
}

/** Startseite je nach Rolle. */
function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'ADMIN' ? '/dashboard' : '/meine-auftraege'} replace />;
}

export default function App() {
  return (
    <Routes>
      {/* Öffentlich */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/passwort-vergessen" element={<ForgotPasswordPage />} />
      <Route path="/passwort-neu" element={<ResetPasswordPage />} />

      {/* Nur Administration */}
      <Route path="/dashboard" element={<RequireAdmin><DashboardPage /></RequireAdmin>} />
      <Route path="/auftraege" element={<RequireAdmin><OrdersPage /></RequireAdmin>} />
      <Route path="/auftraege/neu" element={<RequireAdmin><OrderFormPage /></RequireAdmin>} />
      <Route path="/auftraege/:id/bearbeiten" element={<RequireAdmin><OrderFormPage /></RequireAdmin>} />
      <Route path="/mitarbeiter" element={<RequireAdmin><EmployeesPage /></RequireAdmin>} />
      <Route path="/kunden" element={<RequireAdmin><CustomersPage /></RequireAdmin>} />

      {/* Für beide Rollen (Inhalt richtet sich nach den Rechten) */}
      <Route path="/meine-auftraege" element={<RequireAuth><MyOrdersPage /></RequireAuth>} />
      <Route path="/auftraege/:id" element={<RequireAuth><OrderDetailPage /></RequireAuth>} />
      <Route path="/dienstplan" element={<RequireAuth><SchedulePage /></RequireAuth>} />
      <Route path="/urlaub" element={<RequireAuth><LeavePage /></RequireAuth>} />
      <Route path="/profil" element={<RequireAuth><ProfilePage /></RequireAuth>} />

      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}
