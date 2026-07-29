import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';

const RoleBasedRoot = () => {
  const { user, isAuthenticated } = useAuth();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // CRITICAL: Check localStorage on mount to handle race condition
  useEffect(() => {
    const checkAuth = () => {
      const hasUser = localStorage.getItem('zapeera_user');

      // If we have user in localStorage but AuthContext hasn't updated yet
      // This can happen immediately after login (cookie is set, context lags)
      if (hasUser && (!isAuthenticated || !user)) {
        // Give AuthContext time to update (it should happen on next render)
        setTimeout(() => setIsCheckingAuth(false), 500);
      } else {
        setIsCheckingAuth(false);
      }
    };

    checkAuth();
  }, [isAuthenticated, user]);

  // Show loading while checking
  if (isCheckingAuth) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  // CRITICAL FIX: Always redirect to login if not authenticated
  if (!isAuthenticated || !user) {
    console.log('🔍 [RoleBasedRoot] User not authenticated after check');
    console.log('🔍 [RoleBasedRoot] Redirecting to login');
    return <Navigate to="/login" replace />;
  }

  // All authenticated users land on the main dashboard route.
  return <Navigate to="/dashboard" replace />;
};

export default RoleBasedRoot;
