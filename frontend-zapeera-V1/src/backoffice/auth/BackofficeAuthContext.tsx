import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { BackofficeAdmin, BackofficeRole } from '../types';
import { getPermissionsForRole } from '../permissions';
import { backofficeApi } from '../services/api';

interface BackofficeAuthContextType {
  admin: BackofficeAdmin | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  permissions: string[];
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasRole: (...roles: BackofficeRole[]) => boolean;
}

const BackofficeAuthContext = createContext<BackofficeAuthContextType | null>(null);

export function useBackofficeAuth() {
  const ctx = useContext(BackofficeAuthContext);
  if (!ctx) throw new Error('useBackofficeAuth must be used within BackofficeAuthProvider');
  return ctx;
}

export function BackofficeAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<BackofficeAdmin | null>(() => {
    try {
      const d = localStorage.getItem('backofficeAdmin');
      return d ? JSON.parse(d) : null;
    } catch { return null; }
  });
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!admin;

  const permissions = useMemo(() => {
    if (!admin) return [];
    return getPermissionsForRole(admin.role);
  }, [admin]);

  useEffect(() => {
    let cancelled = false;

    const verifySession = async () => {
      // No stored admin data = no prior session, skip the network call
      if (!localStorage.getItem('backofficeAdmin')) {
        setIsLoading(false);
        return;
      }

      try {
        const res = await backofficeApi.getProfile();
        if (!cancelled && res.success && res.data) {
          setAdmin(res.data);
          localStorage.setItem('backofficeAdmin', JSON.stringify(res.data));
        } else if (!cancelled) {
          setAdmin(null);
          localStorage.removeItem('backofficeAdmin');
        }
      } catch {
        if (!cancelled) {
          setAdmin(null);
          localStorage.removeItem('backofficeAdmin');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    verifySession();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await backofficeApi.login(email, password);
    if (data.success) {
      localStorage.setItem('backofficeAdmin', JSON.stringify(data.data.admin));
      setAdmin(data.data.admin);
      toast.success('Login successful');
    } else {
      throw new Error(data.message || 'Login failed');
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await backofficeApi.logout();
    } catch { /* best-effort cookie clear */ }
    localStorage.removeItem('backofficeAdmin');
    setAdmin(null);
    toast.success('Logged out successfully');
  }, []);

  const hasPermission = useCallback((permission: string) => {
    return permissions.includes(permission);
  }, [permissions]);

  const hasRole = useCallback((...roles: BackofficeRole[]) => {
    if (!admin) return false;
    return roles.includes(admin.role);
  }, [admin]);

  return (
    <BackofficeAuthContext.Provider value={{ admin, isAuthenticated, isLoading, permissions, login, logout, hasPermission, hasRole }}>
      {children}
    </BackofficeAuthContext.Provider>
  );
}
