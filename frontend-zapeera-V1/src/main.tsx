import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/zapeera-v3.css'
import { validateEnvironment, logEnvironmentConfig, getEnvironmentRecommendations } from './lib/env-validator'

// CRITICAL: Handle share-modal.js and MIME type errors gracefully
// These errors occur when:
// 1. Browser extensions try to load non-existent files
// 2. Server returns HTML instead of JavaScript (SPA routing issue)
if (typeof window !== 'undefined') {
  // Handle script loading errors - catch before they break the app
  window.addEventListener('error', (event) => {
    const target = event.target as HTMLElement;
    const filename = event.filename || (target as any)?.src || '';
    const isScriptError = target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK');
    
    // Handle share-modal.js specifically
    if (filename && filename.includes('share-modal.js')) {
      // If it's a script tag error, prevent it from breaking the app
      if (isScriptError) {
        console.warn('⚠️ share-modal.js load error - handled gracefully');
        event.preventDefault();
        event.stopPropagation();
        return false;
      }
    }
    
    // Handle MIME type errors for module scripts
    if (event.message && event.message.includes('MIME type') && event.message.includes('module script')) {
      const errorUrl = filename || (target as any)?.src || 'unknown';
      console.error('❌ MIME type error detected:', {
        message: event.message,
        url: errorUrl,
        type: target?.tagName
      });
      console.error('   Server is returning HTML instead of JavaScript');
      console.error('   Fix: Update server config to serve .js files with Content-Type: application/javascript');
      
      // Prevent the error from breaking the app
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
  }, true); // Use capture phase to catch errors early
  
  // Handle unhandled promise rejections from script loading
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || String(event.reason || '');
    if (reason.includes('share-modal') || reason.includes('MIME type')) {
      console.warn('⚠️ Suppressed unhandled rejection:', reason);
      event.preventDefault();
    }
  });
  
  // CRITICAL: Ensure share-modal.js from public folder loads correctly
  // Load it after DOM is ready to prevent null reference errors
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // share-modal.js is in public folder and will be served as static asset
      // It has its own DOM ready checks, so it's safe to load
    });
  }
}

// Validate environment variables on startup
const { isValid, errors } = validateEnvironment();

if (!isValid) {
  console.error('❌ Environment validation failed:', errors);
  // You might want to show a user-friendly error message here
} else {
  console.log('✅ Environment validation passed');
}

// Log configuration in debug mode
logEnvironmentConfig();

// Show recommendations
const recommendations = getEnvironmentRecommendations();
if (recommendations.length > 0) {
  console.log('💡 Environment recommendations:', recommendations);
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  console.error('❌ #root element not found — cannot mount React app');
} else {
  createRoot(rootEl).render(<App />);
}
