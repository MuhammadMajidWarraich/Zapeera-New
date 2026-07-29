import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Navigate } from 'react-router-dom';

interface AuthStatusProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const AuthStatus: React.FC<AuthStatusProps> = ({ children, fallback }) => {
  const { isAuthenticated, isInitialized, checkAuthStatus, user } = useAuth();

  // Check if user is properly authenticated
  const isProperlyAuthenticated = checkAuthStatus();

  // Check if user account is disabled - allow access to Zapeera screen
  if (user && user.isActive === false) {
    return <>{children}</>;
  }

  // Show loading only while AuthContext is still initializing
  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // After initialization, if authenticated show content
  if (isAuthenticated && user && isProperlyAuthenticated) {
    return <>{children}</>;
  }

  // Not authenticated after init — redirect or show fallback
  if (fallback) {
    return <>{fallback}</>;
  }
  return <Navigate to="/login" replace />;
};

export default AuthStatus;
