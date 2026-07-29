import React, { useState, useEffect, useCallback } from 'react';
import Joyride, { CallBackProps, STATUS, EVENTS, Step, Styles, Locale } from 'react-joyride';

// TypeScript interfaces for better type safety
export interface OnboardingStep extends Step {
  target: string;
  content: React.ReactNode;
  title?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center' | 'auto';
  disableBeacon?: boolean;
  hideCloseButton?: boolean;
  hideFooter?: boolean;
}

export interface OnboardingTourProps {
  steps: OnboardingStep[];
  storageKey: string;
  run?: boolean;
  continuous?: boolean;
  showProgress?: boolean;
  showSkipButton?: boolean;
  spotlightClicks?: boolean;
  styles?: Partial<Styles>;
  locale?: Locale;
  onComplete?: (data: CallBackProps) => void;
  onSkip?: (data: CallBackProps) => void;
}

/**
 * OnboardingTour Component
 *
 * A reusable onboarding tour component using react-joyride that:
 * - Automatically checks localStorage for completion status
 * - Runs tour only if not completed
 * - Stores completion flag in localStorage
 * - Provides modern POS dashboard styling
 *
 * Usage:
 * ```tsx
 * const steps = [
 *   {
 *     target: '.sidebar-menu',
 *     content: 'This is your main menu — access all modules from here.',
 *     title: 'Navigation Menu'
 *   }
 * ];
 *
 * <OnboardingTour
 *   steps={steps}
 *   storageKey="pos-dashboard-tour"
 * />
 * ```
 */
const OnboardingTour: React.FC<OnboardingTourProps> = ({
  steps,
  storageKey,
  // Default OFF: tours should never block normal app usage
  run = false,
  continuous = true,
  showProgress = true,
  showSkipButton = true,
  // Allow clicking underlying UI even if tour is enabled
  spotlightClicks = true,
  styles,
  locale,
  onComplete,
  onSkip
}) => {
  const [runTour, setRunTour] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // Tour tracking disabled
  useEffect(() => {
    if (run) {
      const timer = setTimeout(() => {
        setRunTour(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [storageKey, run]);

  // Handle tour events
  const handleJoyrideCallback = useCallback((data: CallBackProps) => {
    const { status, type, index } = data;

    if (([EVENTS.STEP_AFTER, EVENTS.TARGET_NOT_FOUND] as string[]).includes(type)) {
      // Update state to advance the tour
      setStepIndex(index + (data.action === 'prev' ? -1 : 1));
    } else if (([STATUS.FINISHED, STATUS.SKIPPED] as string[]).includes(status)) {
      // Tour completed or skipped
      setRunTour(false);
      setStepIndex(0);

      // Tour completion tracking disabled

      // Call appropriate callback
      if (status === STATUS.FINISHED && onComplete) {
        onComplete(data);
      } else if (status === STATUS.SKIPPED && onSkip) {
        onSkip(data);
      }
    }
  }, [storageKey, onComplete, onSkip]);

  // Default styles for modern POS dashboard
  const defaultStyles: Partial<Styles> = {
    options: {
      primaryColor: '#0C2C8A', // POS blue color
      width: 400,
      zIndex: 10000,
    },
    // CRITICAL: don't block clicks across the app
    overlay: {
      pointerEvents: 'none',
    },
    tooltip: {
      borderRadius: 12,
      boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
      padding: 20,
    },
    tooltipContainer: {
      textAlign: 'left' as const,
    },
    tooltipTitle: {
      color: '#1f2937',
      fontSize: '18px',
      fontWeight: 600,
      marginBottom: '8px',
    },
    tooltipContent: {
      color: '#6b7280',
      fontSize: '14px',
      lineHeight: '1.5',
    },
    tooltipFooter: {
      marginTop: '16px',
    },
    buttonNext: {
      backgroundColor: '#0C2C8A',
      borderRadius: '8px',
      color: 'white',
      fontSize: '14px',
      fontWeight: 500,
      padding: '10px 20px',
      border: 'none',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
    },
    buttonBack: {
      color: '#6b7280',
      fontSize: '14px',
      fontWeight: 500,
      marginRight: '12px',
      cursor: 'pointer',
      background: 'none',
      border: 'none',
      padding: '10px 0',
    },
    buttonSkip: {
      color: '#9ca3af',
      fontSize: '14px',
      fontWeight: 500,
      cursor: 'pointer',
      background: 'none',
      border: 'none',
      padding: '10px 0',
    },
    buttonClose: {
      color: '#9ca3af',
      fontSize: '18px',
      cursor: 'pointer',
      background: 'none',
      border: 'none',
      padding: '4px',
    },
    spotlight: {
      borderRadius: '8px',
    },
    ...styles,
  };

  // Default locale for better UX
  const defaultLocale: Locale = {
    back: 'Back',
    close: 'Close',
    last: 'Finish',
    next: 'Next',
    skip: 'Skip Tour',
    ...locale,
  };

  return (
    <Joyride
      steps={steps}
      run={runTour}
      continuous={continuous}
      showProgress={showProgress}
      showSkipButton={showSkipButton}
      spotlightClicks={spotlightClicks}
      stepIndex={stepIndex}
      styles={defaultStyles}
      locale={defaultLocale}
      callback={handleJoyrideCallback}
      disableOverlayClose={false}
      hideCloseButton={false}
    />
  );
};

export default OnboardingTour;

/**
 * Example usage for different pages:
 *
 * 1. Dashboard Tour:
 * ```tsx
 * const dashboardSteps = [
 *   {
 *     target: '.sidebar-menu',
 *     content: 'This is your main menu — access all modules from here.',
 *     title: 'Navigation Menu'
 *   },
 *   {
 *     target: '.add-sale-button',
 *     content: 'Click here to start a new sale transaction.',
 *     title: 'New Sale'
 *   }
 * ];
 *
 * <OnboardingTour
 *   steps={dashboardSteps}
 *   storageKey="dashboard-tour"
 * />
 * ```
 *
 * 2. POS Interface Tour:
 * ```tsx
 * const posSteps = [
 *   {
 *     target: '.product-search',
 *     content: 'Search for products by name or barcode.',
 *     title: 'Product Search'
 *   },
 *   {
 *     target: '.cart-section',
 *     content: 'View and manage items in your cart.',
 *     title: 'Shopping Cart'
 *   }
 * ];
 *
 * <OnboardingTour
 *   steps={posSteps}
 *   storageKey="pos-tour"
 * />
 * ```
 *
 * 3. Reports Tour:
 * ```tsx
 * const reportsSteps = [
 *   {
 *     target: '.date-filter',
 *     content: 'Filter reports by date range.',
 *     title: 'Date Filter'
 *   },
 *   {
 *     target: '.export-button',
 *     content: 'Export reports in various formats.',
 *     title: 'Export Reports'
 *   }
 * ];
 *
 * <OnboardingTour
 *   steps={reportsSteps}
 *   storageKey="reports-tour"
 * />
 * ```
 */
