import { useState } from "react";
import { config } from "@/lib/config";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  User,
  Lock,
  Eye,
  EyeOff,
  Shield,
  AlertCircle,
  X,
  Mail,
  CheckCircle,
  Package,
  DollarSign,
  Receipt,
  Users,
  ShoppingCart,
  Building2,
  UserCheck,
  Truck,
  BarChart3,
  WifiOff
} from "lucide-react";
import { apiService } from "@/services/api";
import { normalizeAppRole } from "@/utils/app-role";
import { toast } from "@/hooks/use-toast";
import AccountDeactivationModal from "./AccountDeactivationModal";
import { clearStoredSession, readStoredUser, writeStoredUser } from "@/lib/session-storage";

interface LoginFormProps {
  onLogin: (user: any) => void;
  onNavigateToSignup?: () => void;
  loginHandler?: (credentials: { usernameOrEmail: string; password: string }) => Promise<any>;
}

interface FieldErrors {
  username?: string;
  password?: string;
}

const LoginForm = ({ onLogin, onNavigateToSignup, loginHandler }: LoginFormProps) => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    username: "",
    password: ""
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [showDeactivationModal, setShowDeactivationModal] = useState(false);
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");
  const [forgotPasswordSubmitted, setForgotPasswordSubmitted] = useState(false);
  const [deactivatedUserInfo, setDeactivatedUserInfo] = useState<{
    username?: string;
    email?: string;
    name?: string;
  }>({});
  const [showVerificationBanner, setShowVerificationBanner] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  // Validate individual field
  const validateField = (field: string, value: string): string => {
    switch (field) {
      case 'username':
        if (!value.trim()) return 'Username or email is required';
        if (value.length < 3) return 'Username must be at least 3 characters';
        return '';
      case 'password':
        if (!value.trim()) return 'Password is required';
        if (value.length < 4) return 'Password must be at least 4 characters';
        return '';
      default:
        return '';
    }
  };

  // Validate all fields
  const validateForm = (): boolean => {
    const errors: FieldErrors = {};

    const usernameError = validateField('username', formData.username);
    if (usernameError) errors.username = usernameError;

    const passwordError = validateField('password', formData.password);
    if (passwordError) errors.password = passwordError;

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // CRITICAL: Prevent multiple submissions
    if (isLoading) {
      console.warn('⚠️ [LoginForm] Login already in progress, ignoring duplicate submission');
      return;
    }

    // Validate form
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = loginHandler
        ? await loginHandler({ usernameOrEmail: formData.username, password: formData.password })
        : await apiService.login({
            usernameOrEmail: formData.username,
            password: formData.password
          });

      if (response.success && response.data) {
        const { user } = response.data;

        if (!user || !user.id) {
          setError("Login failed: Invalid user data received from server.");
          return;
        }

        // Auth is now handled via httpOnly cookie — no client-side token storage needed
        try {
          const role = normalizeAppRole(user.role);
          const userForStore = {
            ...user,
            role,
            membership: user.membership
              ? {
                  ...user.membership,
                  roleName: user.membership.roleName ? normalizeAppRole(user.membership.roleName) : undefined,
                }
              : user.membership,
            memberships: Array.isArray(user.memberships)
              ? user.memberships.map((m: any) => ({
                  ...m,
                  roleName: m.roleName ? normalizeAppRole(m.roleName) : undefined,
                }))
              : user.memberships,
          };
          writeStoredUser(userForStore);
        } catch (storageError: any) {
          setError("Login failed: Could not save user data.");
          return;
        }

        const storedUser = readStoredUser();

        if (!storedUser) {
          setError("Login failed: User data not saved properly.");
          return;
        }

        // Call onLogin to update AuthContext (reuse stored shape so memberships persist)
        try {
          await onLogin(JSON.parse(storedUser));
        } catch {
          await onLogin({ ...user, role: normalizeAppRole(user.role) });
        }

        navigate('/dashboard');
      } else {
        if (response.accountDisabled) {
          // Clear any stored data to prevent auto-login on page refresh
          clearStoredSession();
          localStorage.removeItem('auth_initialized');

          setDeactivatedUserInfo({
            username: formData.username,
            email: formData.username.includes('@') ? formData.username : undefined
          });
          setShowDeactivationModal(true);
          setError("");
        } else {
          // Set field-specific errors based on response
          const errorMsg = response.message || 'Login failed';

          // Check for specific error types
          if (errorMsg.toLowerCase().includes('user not found')) {
            setFieldErrors({ username: 'No account found with this username/email' });
          } else if (errorMsg.toLowerCase().includes('password') || errorMsg.toLowerCase().includes('incorrect password')) {
            setFieldErrors({ password: 'Incorrect password' });
          } else if (errorMsg.toLowerCase().includes('invalid credentials')) {
            // Generic invalid credentials - show password error as it's more likely
            // when username/email format is valid
            setFieldErrors({ password: 'Incorrect password' });
          } else if (errorMsg.toLowerCase().includes('not activated') || errorMsg.toLowerCase().includes('not active')) {
            setError('Your account is not activated. Please contact the administrator.');
          } else if (response.emailNotVerified) {
            setShowVerificationBanner(true);
            setVerificationEmail(formData.username.includes('@') ? formData.username : '');
            setError('');
          } else {
            setError(errorMsg || "Login failed. Please check your credentials.");
          }
        }
      }
    } catch (error: any) {
      const errorMessage = error?.message || String(error);

      if (errorMessage.includes('Cannot connect') || errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
        setError("Cannot connect to server. Please check your internet connection and try again.");
      } else if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
        setError("Request timed out. The server may be busy. Please try again.");
      } else {
        setError(errorMessage || "An unexpected error occurred. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    // Clear field error when user starts typing
    if (fieldErrors[field as keyof FieldErrors]) {
      setFieldErrors(prev => ({ ...prev, [field]: undefined }));
    }
    if (error) setError("");
  };

  const handleForgotPassword = () => {
    setShowForgotPasswordModal(true);
    setForgotPasswordSubmitted(false);
    setForgotPasswordEmail("");
  };

  const handleResendVerification = async () => {
    const emailToUse = verificationEmail || formData.username;
    if (!emailToUse.includes('@')) {
      setResendMessage('Please enter your email address in the username field to resend the verification link.');
      return;
    }
    setResendLoading(true);
    setResendMessage('');
    try {
      const response = await apiService.resendVerificationEmail(emailToUse);
      if (response.success) {
        setResendMessage('Verification email sent! Please check your inbox (and spam folder).');
      } else {
        setResendMessage(response.message || 'Failed to resend. Please try again later.');
      }
    } catch (err: any) {
      setResendMessage(err.message || 'Failed to connect to server. Please try again.');
    } finally {
      setResendLoading(false);
    }
  };

  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordResult, setForgotPasswordResult] = useState<{
    success: boolean;
    message: string;
    contactNumber?: string;
  } | null>(null);

  const handleForgotPasswordSubmit = async () => {
    if (!forgotPasswordEmail.trim()) {
      setForgotPasswordResult({
        success: false,
        message: 'Please enter your email address or username.'
      });
      return;
    }

    // No strict validation - accept both email and username (backend will handle it)

    setForgotPasswordLoading(true);
    setForgotPasswordResult(null);

    try {
      const response = await apiService.forgotPassword(forgotPasswordEmail.trim());

      if (response.success) {
        setForgotPasswordResult({
          success: true,
          message: response.message || 'Your request has been submitted successfully.',
          contactNumber: response.contactNumber || config.support.phoneNumber
        });
        setForgotPasswordSubmitted(true);
      } else {
        setForgotPasswordResult({
          success: false,
          message: response.message || 'Failed to submit request. Please try again.'
        });
      }
    } catch (error: any) {
      console.error('Forgot password error:', error);
      setForgotPasswordResult({
        success: false,
        message: error.message || 'Failed to connect to server. Please try again.'
      });
    } finally {
      setForgotPasswordLoading(false);
    }
  };

  return (
    <div className="h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-500/20 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
      </div>

      {/* Left Side - Sign In (White Background with modern styling) */}
      <div className="w-full bg-white/95 backdrop-blur-sm lg:w-3/5 flex items-center justify-center p-8 lg:p-12 relative z-10 overflow-y-auto">
        <div className="w-full max-w-lg">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white border-2 border-gray-200 rounded-2xl mb-4 shadow-lg shadow-gray-200">
              <img src={`${import.meta.env.BASE_URL}images/favicon.png`} alt="Zapeera" className="w-10 h-10 object-contain" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome Back</h1>
            <p className="text-gray-600">Sign in to your Zapeera account</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username Field */}
            <div>
              <label htmlFor="login-username" className="block text-sm font-semibold text-gray-700 mb-2">
                Username or Email
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <User className="w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                </div>
                <input
                  id="login-username"
                  type="text"
                  value={formData.username}
                  onChange={(e) => handleInputChange("username", e.target.value)}
                  className={`w-full pl-12 pr-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 bg-gray-50/50 ${
                    fieldErrors.username 
                      ? 'border-red-500 bg-red-50/50 focus:border-red-500 focus:ring-red-500/20' 
                      : 'border-gray-200 focus:bg-white'
                  }`}
                  placeholder="Enter your username or email"
                />
              </div>
              {/* Field Error Message */}
              {fieldErrors.username && (
                <div className="flex items-center mt-2 text-red-600 animate-pulse">
                  <AlertCircle className="w-4 h-4 mr-1.5" />
                  <span className="text-sm font-medium">{fieldErrors.username}</span>
                </div>
              )}
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="login-password" className="block text-sm font-semibold text-gray-700 mb-2">
                Password
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                </div>
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => handleInputChange("password", e.target.value)}
                  autoComplete="current-password"
                  className={`w-full pl-12 pr-12 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 bg-gray-50/50 ${
                    fieldErrors.password 
                      ? 'border-red-500 bg-red-50/50 focus:border-red-500 focus:ring-red-500/20' 
                      : 'border-gray-200 focus:bg-white'
                  }`}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {/* Field Error Message */}
              {fieldErrors.password && (
                <div className="flex items-center mt-2 text-red-600 animate-pulse">
                  <AlertCircle className="w-4 h-4 mr-1.5" />
                  <span className="text-sm font-medium">{fieldErrors.password}</span>
                </div>
              )}
            </div>

            {/* Verification Required Banner */}
            {showVerificationBanner && (
              <div className="p-5 bg-amber-50 border-2 border-amber-300 rounded-xl space-y-4 animate-in slide-in-from-top-2 duration-300">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <Mail className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm text-amber-900 font-semibold">Email verification required</p>
                    <p className="text-sm text-amber-800 mt-1 leading-relaxed">
                      Your account is created but not yet activated. Please check your inbox for the verification link, or enter your email below to resend it.
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={verificationEmail}
                      onChange={(e) => setVerificationEmail(e.target.value)}
                      placeholder="Enter your email address"
                      className="flex-1 px-3 py-2 text-sm border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                    />
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      disabled={resendLoading}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
                    >
                      {resendLoading ? 'Sending...' : 'Resend'}
                    </button>
                  </div>
                  <p className="text-xs text-amber-700">
                    Make sure to check your spam or junk folder if you do not see the email.
                  </p>
                </div>
                {resendMessage && (
                  <div className={`p-3 rounded-lg text-sm font-medium ${resendMessage.includes('sent') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {resendMessage}
                  </div>
                )}
              </div>
            )}

            {/* General Error Message */}
            {error && (
              <div className="p-4 bg-red-50 border-2 border-red-200 rounded-xl flex items-start animate-in slide-in-from-top-2 duration-300">
                <AlertCircle className="w-5 h-5 text-red-600 mr-3 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 font-medium">{error}</p>
              </div>
            )}

            {/* Forgot Password */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors"
              >
                Forgot password?
              </button>
            </div>

            {/* Sign In Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 text-white py-3 rounded-xl font-semibold hover:from-blue-700 hover:to-cyan-600 transition-all duration-300 shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transform hover:-translate-y-0.5 disabled:hover:translate-y-0"
            >
              {isLoading ? (
                <div className="flex items-center justify-center space-x-2">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Signing in...</span>
                </div>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {/* Sign Up Link */}
          <div className="text-center mt-6">
            <p className="text-sm text-gray-600">
              Don't have an account?{" "}
              <button
                type="button"
                onClick={onNavigateToSignup}
                className="font-semibold text-blue-600 hover:text-blue-700 transition-colors"
              >
                Sign up
              </button>
            </p>
          </div>

          {/* Security note */}
          <div className="mt-6 flex items-center justify-center space-x-2 text-xs text-gray-500">
            <Shield className="w-4 h-4" />
            <span>Your data is secure and encrypted</span>
          </div>
        </div>
      </div>

      {/* Right Side - Welcome (Enhanced Blue Background matching signin button) */}
      <div className="hidden lg:flex lg:w-2/5 relative items-center justify-center p-8 bg-gradient-to-br from-blue-600 via-cyan-500 to-blue-700 overflow-hidden">
        <div className="relative z-10 text-center w-full max-w-md">
          {/* Logo */}
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl mb-4 shadow-2xl">
            <img src={`${import.meta.env.BASE_URL}images/favicon.png`} alt="Zapeera" className="w-10 h-10 object-contain" />
          </div>

          {/* Title */}
          <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">Zapeera</h1>
          <div className="w-16 h-1 bg-gradient-to-r from-transparent via-white/50 to-transparent mx-auto mb-6" />

          {/* Subtitle */}
          <p className="text-base text-white/80 leading-relaxed mb-8">
            The All-in-One Business Management Platform empowering owners, managers & teams to seamlessly manage sales, inventory, branches & growth from anywhere — even offline.
          </p>

          {/* Top 8 Core Features */}
          <div className="grid grid-cols-2 gap-3 text-left">
            <div className="flex items-center space-x-2.5 text-white/90">
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
                <ShoppingCart className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-medium">Point of Sale (POS)</span>
            </div>
            <div className="flex items-center space-x-2.5 text-white/90">
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
                <Package className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-medium">Inventory Management</span>
            </div>
            <div className="flex items-center space-x-2.5 text-white/90">
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
                <Building2 className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-medium">Multi-Branch Support</span>
            </div>
            <div className="flex items-center space-x-2.5 text-white/90">
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
                <Users className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-medium">Role-Based Access</span>
            </div>
            <div className="flex items-center space-x-2.5 text-white/90">
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
                <UserCheck className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-medium">Customer Management</span>
            </div>
            <div className="flex items-center space-x-2.5 text-white/90">
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
                <Truck className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-medium">Purchase & Suppliers</span>
            </div>
            <div className="flex items-center space-x-2.5 text-white/90">
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
                <BarChart3 className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-medium">Reports & Analytics</span>
            </div>
            <div className="flex items-center space-x-2.5 text-white/90">
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
                <WifiOff className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-medium">Works Offline</span>
            </div>
          </div>
        </div>
      </div>

      {/* Account Deactivation Modal */}
      <AccountDeactivationModal
        isOpen={showDeactivationModal}
        onClose={() => setShowDeactivationModal(false)}
        userInfo={deactivatedUserInfo}
      />

      {/* Forgot Password Modal */}
      {showForgotPasswordModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 relative transform transition-all">
            <button
              onClick={() => setShowForgotPasswordModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 transition-colors"
              aria-label="Close forgot password modal"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-cyan-100 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
                <Mail className="w-8 h-8 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">
                {forgotPasswordSubmitted ? 'Request Submitted' : 'Forgot Password?'}
              </h2>
            </div>

            {!forgotPasswordSubmitted ? (
              <>
                <p className="text-gray-600 text-center mb-6">
                  Enter your email address or username and we'll help you reset your password.
                </p>
                <div className="mb-4">
                  <label className="block text-sm font-semibold text-gray-700 mb-2.5">Email Address or Username</label>
                  <input
                    type="text"
                    value={forgotPasswordEmail}
                    onChange={(e) => setForgotPasswordEmail(e.target.value)}
                    className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 bg-gray-50/50"
                    placeholder="Enter your email or username"
                  />
                </div>
                {forgotPasswordResult && !forgotPasswordResult.success && (
                  <div className="mb-4 p-4 bg-red-50 border-2 border-red-200 rounded-xl">
                    <p className="text-sm text-red-700 font-medium">{forgotPasswordResult.message}</p>
                  </div>
                )}
                <button
                  onClick={handleForgotPasswordSubmit}
                  disabled={forgotPasswordLoading}
                  className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 text-white py-3.5 rounded-xl font-semibold hover:from-blue-700 hover:to-cyan-600 transition-all duration-300 shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {forgotPasswordLoading ? (
                    <div className="flex items-center justify-center space-x-2">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Submitting...</span>
                    </div>
                  ) : (
                    'Send Reset Link'
                  )}
                </button>
              </>
            ) : (
              <>
                <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 mb-4">
                  <div className="flex items-start">
                    <CheckCircle className="w-5 h-5 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-green-800 font-semibold mb-1">Check Your Email</p>
                      <p className="text-green-700 text-sm">
                        {forgotPasswordResult?.message || 'If an account with that email exists, you will receive a password reset link shortly.'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 mb-6">
                  <p className="text-blue-800 text-sm font-semibold text-center mb-2">
                    Next Steps:
                  </p>
                  <ul className="text-blue-700 text-sm space-y-2">
                    <li className="flex items-start">
                      <span className="mr-2">1.</span>
                      <span>Check your email inbox (and spam folder)</span>
                    </li>
                    <li className="flex items-start">
                      <span className="mr-2">2.</span>
                      <span>Click the reset link in the email</span>
                    </li>
                    <li className="flex items-start">
                      <span className="mr-2">3.</span>
                      <span>Create your new password</span>
                    </li>
                  </ul>
                  <p className="text-blue-600 text-xs text-center mt-3 font-medium">
                    The reset link will expire in 1 hour
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowForgotPasswordModal(false);
                    setForgotPasswordSubmitted(false);
                    setForgotPasswordResult(null);
                    setForgotPasswordEmail("");
                  }}
                  className="w-full bg-gray-100 text-gray-700 py-3.5 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LoginForm;
