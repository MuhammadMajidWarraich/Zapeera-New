/**
 * Global API Error Handler
 * Handles module access errors and shows upgrade prompts
 *
 * SECURITY: This provides UX for backend-enforced module restrictions
 */

import { toast } from 'sonner';
import { clearModuleAccessCache } from '@/hooks/useModuleAccess';

interface ApiErrorResponse {
  success: false;
  error?: string;
  message?: string;
  module?: string;
  upgradeUrl?: string;
}

const getBusinessSlugFromPath = (pathname: string): string | null => {
  const match = pathname.match(/^\/business\/([^\/]+)/);
  return match?.[1] || null;
};

const getBusinessSubscriptionUrl = (pathname: string): string => {
  const slug = getBusinessSlugFromPath(pathname);
  return slug ? `/business/${encodeURIComponent(slug)}/subscription` : '/subscription';
};

// Generic error type that works with any HTTP client
interface GenericError {
  response?: {
    status: number;
    data: ApiErrorResponse;
  };
}

type ErrorHandler = (error: GenericError) => boolean;

const errorHandlers: ErrorHandler[] = [];

/**
 * Register an error handler
 * Returns unsubscribe function
 */
export function onApiError(handler: ErrorHandler): () => void {
  errorHandlers.push(handler);
  return () => {
    const index = errorHandlers.indexOf(handler);
    if (index > -1) {
      errorHandlers.splice(index, 1);
    }
  };
}

/**
 * Handle API errors globally
 * Returns true if error was handled, false otherwise
 */
export function handleApiError(error: GenericError): boolean {
  const response = error.response;

  if (!response) {
    // Network error - let it propagate
    return false;
  }

  const status = response.status;
  const data = response.data;
  const errorCode = data?.error;

  // Handle 403 MODULE_NOT_ALLOWED
  if (status === 403 && errorCode === 'MODULE_NOT_ALLOWED') {
    const module = data?.module;
    const message = data?.message || 'This feature is not available in your plan';

    // Clear cache so next check fetches fresh data
    clearModuleAccessCache();

    // Show toast notification
    toast.error(message, {
      description: 'Upgrade your subscription to access this feature',
      action: {
        label: 'Upgrade',
        onClick: () => {
          window.location.href = data?.upgradeUrl || getBusinessSubscriptionUrl(window.location.pathname);
        },
      },
    });

    // Dispatch custom event for UI components
    window.dispatchEvent(
      new CustomEvent('module-access-denied', {
        detail: { module, message },
      })
    );

    console.warn('[API Error Handler] Module access denied:', { module, message });

    return true;
  }

  // Handle 401 NO_MEMBERSHIP
  if (status === 401 && errorCode === 'NO_MEMBERSHIP') {
    toast.error('Business Access Required', {
      description: 'Please select a business to continue',
      duration: 5000,
    });

    return true;
  }

  // Handle 400 NO_BUSINESS_CONTEXT
  if (status === 400 && errorCode === 'NO_BUSINESS_CONTEXT') {
    toast.error('Business Context Required', {
      description: 'Please select a business to continue',
      duration: 5000,
    });

    return true;
  }

  // Run custom handlers
  for (const handler of errorHandlers) {
    try {
      if (handler(error)) {
        return true;
      }
    } catch (err) {
      console.error('[API Error Handler] Handler error:', err);
    }
  }

  // Error not handled - let it propagate
  return false;
}

/**
 * Create a response error handler for any HTTP client
 * Usage with fetch-based API:
 *   const handler = createResponseErrorHandler();
 *   handler({ status, data }); // Call with error response
 */
export function createResponseErrorHandler() {
  return (status: number, data: ApiErrorResponse) => {
    const error: GenericError = {
      response: { status, data },
    };
    return handleApiError(error);
  };
}

/**
 * Module access denied event listener
 * Use this in components to react to module access errors
 */
export function onModuleAccessDenied(
  callback: (event: { module: string; message: string }) => void
): () => void {
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<{ module: string; message: string }>;
    callback(customEvent.detail);
  };

  window.addEventListener('module-access-denied', handler);

  return () => {
    window.removeEventListener('module-access-denied', handler);
  };
}

/**
 * Check if an error is a module access error
 */
export function isModuleAccessError(error: GenericError): boolean {
  return (
    error.response?.status === 403 &&
    error.response?.data?.error === 'MODULE_NOT_ALLOWED'
  );
}

/**
 * Get upgrade URL from error
 */
export function getUpgradeUrl(error: GenericError): string {
  return error.response?.data?.upgradeUrl || getBusinessSubscriptionUrl(window.location.pathname);
}
