import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, Loader2, Mail } from "lucide-react";
import { apiService } from "@/services/api";

const VerifyEmail = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Verifying your email...");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      setMessage("Invalid verification link. No token provided.");
      return;
    }

    const verify = async () => {
      try {
        const response = await apiService.verifyEmail(token);
        if (response.success) {
          setStatus("success");
          setMessage(response.message || "Your email has been verified successfully!");
        } else {
          setStatus("error");
          setMessage(response.message || "Verification failed. The link may have expired.");
        }
      } catch (err: any) {
        setStatus("error");
        setMessage(err.message || "An error occurred while verifying your email.");
      }
    };

    verify();
  }, [searchParams]);

  const handleResend = async () => {
    const email = searchParams.get("email");
    if (!email) {
      setResendMessage("Unable to resend: email address not available in the link.");
      return;
    }
    setResendLoading(true);
    setResendMessage("");
    try {
      const response = await apiService.resendVerificationEmail(email);
      if (response.success) {
        setResendMessage("A new verification link has been sent to your email.");
      } else {
        setResendMessage(response.message || "Failed to resend. Please try again later.");
      }
    } catch (err: any) {
      setResendMessage(err.message || "Failed to connect to server.");
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-2xl mb-6">
          <img src={`${import.meta.env.BASE_URL}images/favicon.png`} alt="Zapeera" className="w-10 h-10 object-contain" />
        </div>

        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Verifying your email</h2>
            <p className="text-gray-600">{message}</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Email Verified!</h2>
            <p className="text-gray-600 mb-6">{message}</p>
            <button
              onClick={() => navigate("/login")}
              className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 text-white py-3 rounded-xl font-semibold hover:from-blue-700 hover:to-cyan-600 transition-all shadow-lg shadow-blue-500/30"
            >
              Go to Login
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Verification Failed</h2>
            <p className="text-gray-600 mb-4">{message}</p>
            <div className="space-y-3">
              <button
                onClick={handleResend}
                disabled={resendLoading}
                className="w-full flex items-center justify-center gap-2 bg-gray-100 text-gray-800 py-3 rounded-xl font-semibold hover:bg-gray-200 transition-all disabled:opacity-50"
              >
                <Mail className="w-4 h-4" />
                {resendLoading ? "Sending..." : "Resend Verification Email"}
              </button>
              {resendMessage && (
                <p className={`text-sm font-medium ${resendMessage.includes("sent") ? "text-green-600" : "text-red-600"}`}>
                  {resendMessage}
                </p>
              )}
              <button
                onClick={() => navigate("/login")}
                className="w-full text-blue-600 font-semibold hover:text-blue-700 transition-colors py-2"
              >
                Back to Login
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
