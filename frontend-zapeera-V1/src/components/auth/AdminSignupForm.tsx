import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  User,
  Lock,
  Eye,
  EyeOff,
  Mail,
  CheckCircle,
  AlertCircle,
  Shield,
  ShoppingCart,
  Package,
  Building2,
  Users,
  UserCheck,
  Truck,
  BarChart3,
  WifiOff
} from "lucide-react";
import { apiService } from "@/services/api";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface AdminSignupFormProps {
  onNavigateToLogin?: () => void;
}

const AdminSignupForm = ({ onNavigateToLogin }: AdminSignupFormProps) => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    name: "",
    branchName: "",
    branchAddress: "",
    branchPhone: ""
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [nameError, setNameError] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [showSuccessDialog, setShowSuccessDialog] = useState(false); // NEW: Success dialog
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [passwordStrength, setPasswordStrength] = useState({
    hasUpperCase: false,
    hasLowerCase: false,
    hasNumber: false,
    hasSpecialChar: false,
    minLength: false
  });

  // Password validation function
  const validatePassword = (password: string) => {
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    const minLength = password.length >= 8;

    setPasswordStrength({
      hasUpperCase,
      hasLowerCase,
      hasNumber,
      hasSpecialChar,
      minLength
    });

    return hasUpperCase && hasLowerCase && hasNumber && hasSpecialChar && minLength;
  };

  // Check if password meets all requirements
  const isPasswordValid = () => {
    return passwordStrength.hasUpperCase &&
           passwordStrength.hasLowerCase &&
           passwordStrength.hasNumber &&
           passwordStrength.hasSpecialChar &&
           passwordStrength.minLength;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    // Step-wise validation / progression
    if (step === 1) {
      let hasErrors = false;

      // Validate name
      if (!formData.name.trim()) {
        setNameError("Full name is required");
        hasErrors = true;
      } else if (formData.name.trim().length < 2) {
        setNameError("Name must be at least 2 characters");
        hasErrors = true;
      }

      // Validate username
      if (!formData.username.trim()) {
        setUsernameError("Username is required");
        hasErrors = true;
      } else if (formData.username.trim().length < 3) {
        setUsernameError("Username must be at least 3 characters");
        hasErrors = true;
      } else if (!/^[a-zA-Z0-9_]+$/.test(formData.username)) {
        setUsernameError("Username can only contain letters, numbers and underscore");
        hasErrors = true;
      }

      // Validate email
      if (!formData.email.trim()) {
        setEmailError("Email address is required");
        hasErrors = true;
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
        setEmailError("Please enter a valid email address");
        hasErrors = true;
      }

      if (hasErrors) {
        return;
      }

      setStep(2);
      return;
    }

    if (step === 2) {
      let hasErrors = false;

      // Validate password
      if (!formData.password.trim()) {
        setPasswordError("Password is required");
        hasErrors = true;
      } else if (!validatePassword(formData.password)) {
        setPasswordError("Password does not meet all requirements");
        hasErrors = true;
      }

      // Validate confirm password
      if (!formData.confirmPassword.trim()) {
        setConfirmPasswordError("Please confirm your password");
        hasErrors = true;
      } else if (formData.password !== formData.confirmPassword) {
        setConfirmPasswordError("Passwords do not match");
        hasErrors = true;
      }

      if (hasErrors) {
        return;
      }
      // Final submit on step 2 (no more steps needed)
    }
    
    // CRITICAL: Prevent multiple submissions
    if (isLoading) {
      console.warn('⚠️ [SignupForm] Registration already in progress, ignoring duplicate submission');
      return;
    }
    
    setIsLoading(true);

    try {
      const response = await apiService.register({
        username: formData.username,
        email: formData.email,
        password: formData.password,
        name: formData.name,
        branchId: ""
        // Role is automatically set to USER by backend - no need to send it
        // No branchId or branchData needed - admin will create companies from dashboard
      });

      if (response.success) {
        // Show success dialog
        setShowSuccessDialog(true);
        setRegisteredEmail(formData.email);
        setSuccess("Account created successfully!");

        // Clear form
        setFormData({
          username: "",
          email: "",
          password: "",
          confirmPassword: "",
          name: "",
          branchName: "",
          branchAddress: "",
          branchPhone: ""
        });
        setStep(1);
      } else {
        setError(response.message || "Registration failed");

        // Show specific toast based on the error field
        if ((response as any).field === 'username') {
          setUsernameError("Username already exists");
          toast({
            title: "Username already exists",
            description: "Please choose a different username.",
            variant: "destructive",
            duration: 3000,
          });
        } else if ((response as any).field === 'email') {
          setEmailError("Email already exists");
          toast({
            title: "Email already exists",
            description: "This email is already registered. Please use a different email or try logging in.",
            variant: "destructive",
            duration: 3000,
          });
        } else {
          toast({
            title: "Registration failed",
            description: response.message || "Please review your details and try again.",
            variant: "destructive",
            duration: 3000,
          });
        }
      }
    } catch (error: any) {
      setError(error instanceof Error ? error.message : "Registration failed. Please try again.");

      // Always show a toast for debugging
      toast({
        title: "Registration Error",
        description: `Error: ${error.message || 'Unknown error'}, Field: ${error.field || 'none'}`,
        variant: "destructive",
        duration: 5000,
      });

      // Check if the error has field information
      if (error.field === 'username') {
        setUsernameError("Username already exists");
        toast({
          title: "Username already exists",
          description: "Please choose a different username.",
          variant: "destructive",
          duration: 3000,
        });
      } else if (error.field === 'email') {
        setEmailError("Email already exists");
        toast({
          title: "Email already exists",
          description: "This email is already registered. Please use a different email or try logging in.",
          variant: "destructive",
          duration: 3000,
        });
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
    if (error) setError("");

    // Clear field-specific errors when user starts typing
    if (field === 'name') {
      setNameError("");
    } else if (field === 'username') {
      setUsernameError("");
    } else if (field === 'email') {
      setEmailError("");
    } else if (field === 'password') {
      setPasswordError("");
      validatePassword(value);
    } else if (field === 'confirmPassword') {
      setConfirmPasswordError("");
    }
  };

  // Function to check if username exists
  const checkUsernameExists = async (username: string) => {
    if (username.length < 3) return;

    try {
      // We'll create a simple check endpoint or use the existing validation
      // For now, we'll clear the error and let the form submission handle it
      setUsernameError("");
    } catch (error) {
      console.error('Error checking username:', error);
    }
  };

  // Function to check if email exists
  const checkEmailExists = async (email: string) => {
    if (!email.includes('@')) return;

    try {
      // We'll create a simple check endpoint or use the existing validation
      // For now, we'll clear the error and let the form submission handle it
      setEmailError("");
    } catch (error) {
      console.error('Error checking email:', error);
    }
  };

  // Handle dialog close - redirect to login
  const handleSuccessDialogClose = () => {
    setShowSuccessDialog(false);
    if (onNavigateToLogin) {
      onNavigateToLogin();
    } else {
      navigate('/login');
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

      {/* Success Dialog */}
      <Dialog open={showSuccessDialog} onOpenChange={handleSuccessDialogClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-4">
                <Mail className="w-10 h-10 text-amber-600" />
              </div>
              <DialogTitle className="text-xl font-bold text-gray-900">
                Account Created — Verification Required
              </DialogTitle>
              <DialogDescription className="mt-4 text-gray-600" asChild>
                <div>
                  <p className="mb-4">
                    Thank you for signing up! Your account has been created successfully.
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                    <p className="text-amber-800 font-medium mb-2">
                      Verify Your Email to Activate
                    </p>
                    <p className="text-amber-700 text-sm">
                      A verification link has been sent to <strong>{registeredEmail}</strong>. Please check your inbox (and spam folder) and click the link to activate your account before logging in.
                    </p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-blue-800 font-medium mb-2">
                      Next Step
                    </p>
                    <p className="text-blue-700 text-sm">
                      Once verified, go to the login page and sign in with your username and password.
                    </p>
                  </div>
                </div>
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="mt-4 space-y-2">
            <Button
              onClick={handleSuccessDialogClose}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              Go to Login Page
            </Button>
            <p className="text-xs text-gray-500 text-center">
              Did not receive the email? You can resend it from the login page.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Left Side - Signup Form (White Background) */}
      <div className="w-full bg-white/95 backdrop-blur-sm lg:w-3/5 flex items-center justify-center p-8 lg:p-12 relative z-10 overflow-y-auto">
        <div className="w-full max-w-lg">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white border-2 border-gray-200 rounded-2xl mb-4 shadow-lg shadow-gray-200">
              <img src={`${import.meta.env.BASE_URL}images/favicon.png`} alt="Zapeera" className="w-10 h-10 object-contain" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Create Account</h1>
            <p className="text-gray-600">Set up your Zapeera business account</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {step === 1 && (
              <>
                {/* Name Field */}
                <div>
                  <label htmlFor="signup-name" className="block text-sm font-semibold text-gray-700 mb-2">
                    Full Name
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <User className="w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    </div>
                    <input
                      id="signup-name"
                      type="text"
                      value={formData.name}
                      onChange={(e) => handleInputChange("name", e.target.value)}
                      className={`w-full pl-12 pr-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 bg-gray-50/50 ${
                        nameError
                          ? 'border-red-500 bg-red-50/50 focus:border-red-500 focus:ring-red-500/20'
                          : 'border-gray-200 focus:bg-white'
                      }`}
                      placeholder="Enter your full name"
                    />
                  </div>
                  {nameError && (
                    <div className="flex items-center mt-2 text-red-600 animate-pulse">
                      <AlertCircle className="w-4 h-4 mr-1.5" />
                      <span className="text-sm font-medium">{nameError}</span>
                    </div>
                  )}
                </div>

                {/* Username Field */}
                <div>
                  <label htmlFor="signup-username" className="block text-sm font-semibold text-gray-700 mb-2">
                    Username
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <User className="w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    </div>
                    <input
                      id="signup-username"
                      type="text"
                      value={formData.username}
                      onChange={(e) => handleInputChange("username", e.target.value)}
                      className={`w-full pl-12 pr-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 bg-gray-50/50 ${
                        usernameError
                          ? 'border-red-500 bg-red-50/50 focus:border-red-500 focus:ring-red-500/20'
                          : 'border-gray-200 focus:bg-white'
                      }`}
                      placeholder="Choose a username"
                    />
                  </div>
                  {usernameError && (
                    <div className="flex items-center mt-2 text-red-600 animate-pulse">
                      <AlertCircle className="w-4 h-4 mr-1.5" />
                      <span className="text-sm font-medium">{usernameError}</span>
                    </div>
                  )}
                </div>

                {/* Email Field */}
                <div>
                  <label htmlFor="signup-email" className="block text-sm font-semibold text-gray-700 mb-2">
                    Email Address
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Mail className="w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    </div>
                    <input
                      id="signup-email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleInputChange("email", e.target.value)}
                      className={`w-full pl-12 pr-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 bg-gray-50/50 ${
                        emailError
                          ? 'border-red-500 bg-red-50/50 focus:border-red-500 focus:ring-red-500/20'
                          : 'border-gray-200 focus:bg-white'
                      }`}
                      placeholder="Enter your email address"
                    />
                  </div>
                  {emailError && (
                    <div className="flex items-center mt-2 text-red-600 animate-pulse">
                      <AlertCircle className="w-4 h-4 mr-1.5" />
                      <span className="text-sm font-medium">{emailError}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                {/* Password Field */}
                <div>
                  <label htmlFor="signup-password" className="block text-sm font-semibold text-gray-700 mb-2">
                    Password
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Lock className="w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    </div>
                    <input
                      id="signup-password"
                      type={showPassword ? "text" : "password"}
                      value={formData.password}
                      onChange={(e) => handleInputChange("password", e.target.value)}
                      className={`w-full pl-12 pr-12 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 bg-gray-50/50 ${
                        passwordError
                          ? 'border-red-500 bg-red-50/50 focus:border-red-500 focus:ring-red-500/20'
                          : 'border-gray-200 focus:bg-white'
                      }`}
                      placeholder="Create a password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {passwordError && (
                    <div className="flex items-center mt-2 text-red-600 animate-pulse">
                      <AlertCircle className="w-4 h-4 mr-1.5" />
                      <span className="text-sm font-medium">{passwordError}</span>
                    </div>
                  )}
                  {/* Password Strength Indicator */}
                  {formData.password && (
                    <div className="mt-3 space-y-2 p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <div className="text-xs font-semibold text-gray-700">Password Requirements:</div>
                      <div className="space-y-1.5">
                        <div className={`flex items-center text-xs ${passwordStrength.minLength ? 'text-green-600' : 'text-gray-500'}`}>
                          <div className={`w-2 h-2 rounded-full mr-2 ${passwordStrength.minLength ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                          At least 8 characters
                        </div>
                        <div className={`flex items-center text-xs ${passwordStrength.hasUpperCase ? 'text-green-600' : 'text-gray-500'}`}>
                          <div className={`w-2 h-2 rounded-full mr-2 ${passwordStrength.hasUpperCase ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                          One uppercase letter (A-Z)
                        </div>
                        <div className={`flex items-center text-xs ${passwordStrength.hasLowerCase ? 'text-green-600' : 'text-gray-500'}`}>
                          <div className={`w-2 h-2 rounded-full mr-2 ${passwordStrength.hasLowerCase ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                          One lowercase letter (a-z)
                        </div>
                        <div className={`flex items-center text-xs ${passwordStrength.hasNumber ? 'text-green-600' : 'text-gray-500'}`}>
                          <div className={`w-2 h-2 rounded-full mr-2 ${passwordStrength.hasNumber ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                          One number (0-9)
                        </div>
                        <div className={`flex items-center text-xs ${passwordStrength.hasSpecialChar ? 'text-green-600' : 'text-gray-500'}`}>
                          <div className={`w-2 h-2 rounded-full mr-2 ${passwordStrength.hasSpecialChar ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                          One special character (!@#$%^&*)
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirm Password Field */}
                <div>
                  <label htmlFor="signup-confirmPassword" className="block text-sm font-semibold text-gray-700 mb-2">
                    Confirm Password
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Lock className="w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    </div>
                    <input
                      id="signup-confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      value={formData.confirmPassword}
                      onChange={(e) => handleInputChange("confirmPassword", e.target.value)}
                      className={`w-full pl-12 pr-12 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200 bg-gray-50/50 ${
                        confirmPasswordError
                          ? 'border-red-500 bg-red-50/50 focus:border-red-500 focus:ring-red-500/20'
                          : 'border-gray-200 focus:bg-white'
                      }`}
                      placeholder="Confirm your password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {confirmPasswordError && (
                    <div className="flex items-center mt-2 text-red-600 animate-pulse">
                      <AlertCircle className="w-4 h-4 mr-1.5" />
                      <span className="text-sm font-medium">{confirmPasswordError}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* General Error Message */}
            {error && (
              <div className="p-4 bg-red-50 border-2 border-red-200 rounded-xl flex items-start animate-in slide-in-from-top-2 duration-300">
                <AlertCircle className="w-5 h-5 text-red-600 mr-3 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 font-medium">{error}</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-2">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => (s > 1 ? (s - 1) as 1 | 2 : s))}
                  className="px-5 py-2.5 rounded-xl border-2 border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-all duration-200"
                >
                  Previous
                </button>
              ) : <div />}
              <button
                type="submit"
                disabled={isLoading}
                className="bg-gradient-to-r from-blue-600 to-cyan-500 text-white px-8 py-3 rounded-xl font-semibold hover:from-blue-700 hover:to-cyan-600 transition-all duration-300 shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transform hover:-translate-y-0.5 disabled:hover:translate-y-0"
              >
                {isLoading ? (
                  <div className="flex items-center justify-center space-x-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Creating Account...</span>
                  </div>
                ) : (
                  step < 2 ? 'Next' : 'Create Account'
                )}
              </button>
            </div>
          </form>

          {/* Sign In Link */}
          <div className="text-center mt-6">
            <p className="text-sm text-gray-600">
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => (onNavigateToLogin ? onNavigateToLogin() : navigate('/login'))}
                className="font-semibold text-blue-600 hover:text-blue-700 transition-colors"
              >
                Sign in
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

      {/* Right Side - Welcome (Matching login right side) */}
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
    </div>
  );
};

export default AdminSignupForm;
