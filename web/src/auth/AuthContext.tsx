/**
 * Anmeldezustand der App.
 *
 * Hält den angemeldeten Benutzer, kümmert sich um An-/Abmeldung und stellt
 * die Rolle bereit. Beim Start wird ein gespeichertes Token geprüft, sodass
 * ein Neuladen der Seite nicht abmeldet.
 *
 * WICHTIG: Die Rolle steuert hier nur die Anzeige. Verbindlich geprüft werden
 * die Rechte im Backend (siehe server/src/middleware/auth.js).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi, setUnauthorizedHandler, tokenStore } from '../api/client';
import type { User } from '../api/types';

interface AuthContextValue {
  user: User | null;
  /** true, solange beim Start das gespeicherte Token geprüft wird */
  loading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  /** Nach dem Ändern des eigenen Passworts den Benutzer aktualisieren */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  // Läuft die Sitzung serverseitig ab, meldet der API-Client hierher zurück.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  // Beim Start: gespeichertes Token gegen den Server prüfen
  useEffect(() => {
    const token = tokenStore.get();
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then((response) => setUser(response.user))
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    tokenStore.set(response.token);
    setUser(response.user);
    return response.user;
  }, []);

  const refresh = useCallback(async () => {
    const response = await authApi.me();
    setUser(response.user);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, isAdmin: user?.role === 'ADMIN', login, logout, refresh }),
    [user, loading, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Zugriff auf den Anmeldezustand in beliebigen Komponenten. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth muss innerhalb von <AuthProvider> verwendet werden');
  return context;
}
