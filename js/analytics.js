/**
 * analytics.js — GasLamar
 * Centralized wrapper around PostHog.
 * All other JS files call Analytics.* — never posthog.* directly.
 *
 * Load order: after PostHog snippet in <head>, before page-specific JS.
 * Replace YOUR_POSTHOG_PROJECT_KEY with your actual PostHog project API key.
 */

(function () {
  'use strict';

  var USER_ID_KEY = 'gaslamar_user_id';

  function ph() {
    return window.posthog || { capture: function () {}, identify: function () {}, onFeatureFlags: function () {}, getFeatureFlag: function () {} };
  }

  function toHex(bytes) {
    return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function getOrCreateStableUserId() {
    try {
      var existing = localStorage.getItem(USER_ID_KEY);
      if (existing && /^gl_[a-f0-9]{32}$/.test(existing)) return existing;
      var raw = new Uint8Array(16);
      crypto.getRandomValues(raw);
      var created = 'gl_' + toHex(raw);
      localStorage.setItem(USER_ID_KEY, created);
      return created;
    } catch (_) {
      // localStorage may be blocked (private mode). Keep a deterministic fallback in-memory per page.
      if (!window.__gaslamarEphemeralUserId) {
        var tmp = new Uint8Array(16);
        crypto.getRandomValues(tmp);
        window.__gaslamarEphemeralUserId = 'gl_' + toHex(tmp);
      }
      return window.__gaslamarEphemeralUserId;
    }
  }

  async function sha256Hex(input) {
    if (!crypto || !crypto.subtle) return null;
    var normalized = String(input || '').trim().toLowerCase();
    if (!normalized) return null;
    var data = new TextEncoder().encode(normalized);
    var hash = await crypto.subtle.digest('SHA-256', data);
    return toHex(new Uint8Array(hash));
  }

  function getSessionProps() {
    var tier = sessionStorage.getItem('gaslamar_tier') || localStorage.getItem('gaslamar_tier') || undefined;
    return tier ? { tier_intent: tier } : {};
  }

  var Analytics = {

    /**
     * Identify user by email. Merges all prior anonymous events into this person.
     * @param {string} email
     * @param {Object} [traits]  extra person properties
     */
    identify: function (email, traits) {
      var stableId = getOrCreateStableUserId();
      var safeTraits = Object.assign({}, traits || {});
      delete safeTraits.email;

      if (!email) {
        ph().identify(stableId, Object.assign({ user_id: stableId }, safeTraits));
        return;
      }

      sha256Hex(email).then(function (hashed) {
        var id = hashed ? ('glh_' + hashed) : stableId;
        var props = hashed
          ? Object.assign({ user_hash: hashed, user_id: stableId }, safeTraits)
          : Object.assign({ user_id: stableId }, safeTraits);
        ph().identify(id, props);
      }).catch(function () {
        ph().identify(stableId, Object.assign({ user_id: stableId }, safeTraits));
      });
    },

    /**
     * Track an event.
     * @param {string} name
     * @param {Object} [params]
     */
    track: function (name, params) {
      var props = Object.assign({}, getSessionProps(), params || {});
      ph().capture(name, props);
    },

    /**
     * Track an error event.
     * @param {string} context   where it happened (e.g. 'payment_api')
     * @param {Object} [params]
     */
    trackError: function (context, params) {
      Analytics.track('error_occurred', Object.assign({ error_context: context }, params || {}));
    },

    /**
     * A/B testing: get feature flag variant.
     * @param {string} flagKey
     * @returns {string|boolean|undefined}
     */
    getVariant: function (flagKey) {
      return ph().getFeatureFlag(flagKey);
    },

    /**
     * A/B testing: register a callback for when flags are loaded.
     * @param {Function} callback
     */
    onFlagsReady: function (callback) {
      ph().onFeatureFlags(callback);
    },

  };

  window.Analytics = Analytics;

  // Global unhandled promise rejection catcher
  window.addEventListener('unhandledrejection', function (e) {
    Analytics.trackError('unhandled_rejection', {
      error_message: e.reason && e.reason.message ? e.reason.message.slice(0, 150) : String(e.reason).slice(0, 150),
    });
  });

})();
