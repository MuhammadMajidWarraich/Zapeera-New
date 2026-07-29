/**
 * Share Modal Script - Safe Implementation
 * This script handles share modal functionality only when the modal exists
 * Prevents errors when the modal is not present on the page
 * 
 * CRITICAL: All DOM access is null-checked to prevent "Cannot read properties of null" errors
 */

(function() {
  'use strict';

  // Wait for DOM to be ready - CRITICAL: Don't access DOM before it's ready
  function domReady(fn) {
    if (typeof document === 'undefined') {
      // Not in browser environment
      return;
    }
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      // DOM already ready
      fn();
    }
  }

  // Safe element query with null check - CRITICAL: Always returns null if element doesn't exist
  function safeQuerySelector(selector) {
    if (typeof document === 'undefined' || !selector) {
      return null;
    }
    
    try {
      const element = document.querySelector(selector);
      return element; // Can be null, which is fine
    } catch (e) {
      // Invalid selector - return null instead of throwing
      return null;
    }
  }

  // Initialize share modal only if it exists - CRITICAL: All checks before addEventListener
  function initShareModal() {
    // CRITICAL: Check if document exists
    if (typeof document === 'undefined') {
      return;
    }

    // Look for common share modal selectors
    const shareModal = safeQuerySelector('#share-modal') ||
                      safeQuerySelector('.share-modal') ||
                      safeQuerySelector('[data-share-modal]') ||
                      safeQuerySelector('share-modal');

    // CRITICAL: If no share modal exists, exit silently - don't try to add event listeners
    if (!shareModal) {
      // Modal doesn't exist on this page - this is normal and expected
      // Exit silently without errors
      return;
    }

    // Get share button/trigger - CRITICAL: Check for null before using
    const shareButton = safeQuerySelector('[data-share-button]') ||
                       safeQuerySelector('.share-button') ||
                       safeQuerySelector('#share-button');

    // Get close button - CRITICAL: Check for null before using
    const closeButton = safeQuerySelector('[data-close-share]') ||
                       safeQuerySelector('.close-share-modal') ||
                       safeQuerySelector('#close-share-modal');

    // CRITICAL: Add event listeners only if elements exist (null check)
    if (shareButton && shareModal) {
      shareButton.addEventListener('click', function(e) {
        e.preventDefault();
        // Double-check shareModal still exists
        if (shareModal) {
          shareModal.style.display = 'block';
          shareModal.setAttribute('aria-hidden', 'false');
        }
      });
    }

    // CRITICAL: Null check before addEventListener
    if (closeButton && shareModal) {
      closeButton.addEventListener('click', function(e) {
        e.preventDefault();
        // Double-check shareModal still exists
        if (shareModal) {
          shareModal.style.display = 'none';
          shareModal.setAttribute('aria-hidden', 'true');
        }
      });
    }

    // Close on outside click - CRITICAL: Null check
    if (shareModal) {
      shareModal.addEventListener('click', function(e) {
        if (e.target === shareModal && shareModal) {
          shareModal.style.display = 'none';
          shareModal.setAttribute('aria-hidden', 'true');
        }
      });
    }

    // Close on Escape key - CRITICAL: Null check before accessing
    if (shareModal && typeof document !== 'undefined') {
      document.addEventListener('keydown', function(e) {
        // CRITICAL: Check shareModal exists before accessing its properties
        if (e.key === 'Escape' && shareModal && shareModal.style && shareModal.style.display === 'block') {
          shareModal.style.display = 'none';
          shareModal.setAttribute('aria-hidden', 'true');
        }
      });
    }
  }

  // Initialize when DOM is ready - CRITICAL: Error handling
  domReady(function() {
    try {
      initShareModal();
    } catch (error) {
      // CRITICAL: Silently handle any errors - don't break the page
      // This ensures the script never causes "Cannot read properties of null" errors
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('Share modal initialization error (non-critical, page continues normally):', error);
      }
    }
  });

  // Export for module systems if needed (optional)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initShareModal };
  }
})();
