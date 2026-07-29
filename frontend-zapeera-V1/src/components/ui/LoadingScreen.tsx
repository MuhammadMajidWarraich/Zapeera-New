/**
 * LoadingScreen Component
 * Full-screen loading indicator with message
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingScreenProps {
  message?: string;
  subMessage?: string;
}

export function LoadingScreen({ message = 'Loading...', subMessage }: LoadingScreenProps) {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-white">
      <div className="text-center">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600 mx-auto mb-4" />
        <h2 className="text-lg font-medium text-gray-900">{message}</h2>
        {subMessage && (
          <p className="text-sm text-gray-500 mt-2">{subMessage}</p>
        )}
      </div>
    </div>
  );
}

/**
 * InlineLoading Component
 * Smaller loading indicator for inline use
 */
export function InlineLoading({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center p-4">
      <Loader2 className="h-5 w-5 animate-spin text-blue-600 mr-2" />
      <span className="text-sm text-gray-600">{message}</span>
    </div>
  );
}

/**
 * SkeletonCard Component
 * Placeholder loading card
 */
export function SkeletonCard() {
  return (
    <div className="animate-pulse bg-white rounded-lg shadow p-4">
      <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
      <div className="h-8 bg-gray-200 rounded w-1/2 mb-4"></div>
      <div className="h-4 bg-gray-200 rounded w-full"></div>
    </div>
  );
}

export default LoadingScreen;
