import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleTryAgain = (): void => {
    this.setState({ hasError: false, error: null });
  };

  handleGoToDashboard = (): void => {
    window.location.href = "/zapeera";
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-[400px] items-center justify-center bg-[#f0f2f7] p-6">
          <div className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-8 text-center shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
              <AlertTriangle className="h-7 w-7 text-red-500" />
            </div>
            <h2 className="mb-2 text-lg font-semibold text-[#1a1f36]">
              Something went wrong
            </h2>
            <p className="mb-1 text-sm text-[#4a5578]">
              An unexpected error occurred. Please try again or return to the dashboard.
            </p>
            {this.state.error?.message && (
              <p className="mb-6 rounded-lg bg-red-50 px-3 py-2 font-mono text-xs text-red-600">
                {this.state.error.message}
              </p>
            )}
            {!this.state.error?.message && <div className="mb-6" />}
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleTryAgain}
                className="inline-flex items-center gap-2 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_3px_12px_rgba(26,82,197,0.2)] transition-all hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(26,82,197,0.3)]"
              >
                <RefreshCw className="h-4 w-4" />
                Try Again
              </button>
              <button
                onClick={this.handleGoToDashboard}
                className="inline-flex items-center gap-2 rounded-[10px] border border-[rgba(15,23,60,0.12)] bg-white px-5 py-2.5 text-sm font-semibold text-[#4a5578] shadow-sm transition-colors hover:border-black/15 hover:bg-gray-50"
              >
                <Home className="h-4 w-4" />
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
