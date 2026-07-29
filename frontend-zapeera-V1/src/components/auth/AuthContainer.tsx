import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { apiService } from "../../services/api";
import LoginForm from "./LoginForm";
import AdminSignupForm from "./AdminSignupForm";

const AuthContainer = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  
  // Determine initial view based on current route - default to login
  const getInitialView = (): 'login' | 'signup' => {
    const pathname = location.pathname || '';
    
    // Only show signup if explicitly on /signup route
    return pathname === '/signup' ? 'signup' : 'login';
  };
  
  const [currentView, setCurrentView] = useState<'login' | 'signup'>(() => {
    // Initialize with login by default, then check route
    const initial = getInitialView();
    return initial;
  });

  // Update view when route changes
  useEffect(() => {
    const pathname = location.pathname || '';
    
    if (pathname === '/signup') {
      setCurrentView('signup');
    } else if (pathname === '/login' || pathname === '' || pathname === '/') {
      setCurrentView('login');
    }
  }, [location.pathname]);

  const handleNavigateToSignup = () => {
    setCurrentView('signup');
  };

  const handleNavigateToLogin = () => {
    setCurrentView('login');
  };

  const handleLogin = (user: any) => {
    login(user);

    // Sync account data from cloud (memberships, businesses, roles)
    apiService.syncAccount().catch(() => {});

    navigate('/dashboard');
  };

  return (
    <div className="relative min-h-screen overflow-y-auto">
      {/* Login Form */}
      <div
        className={`absolute inset-0 transition-transform duration-700 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          currentView === 'login' ? 'translate-x-0' : '-translate-x-full'
        } overflow-y-auto`}
      >
        <LoginForm onLogin={handleLogin} onNavigateToSignup={handleNavigateToSignup} />
      </div>

      {/* Signup Form */}
      <div
        className={`absolute inset-0 transition-transform duration-700 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          currentView === 'signup' ? 'translate-x-0' : 'translate-x-full'
        } overflow-y-auto`}
      >
        <AdminSignupForm onNavigateToLogin={handleNavigateToLogin} />
      </div>
    </div>
  );
};

export default AuthContainer;
