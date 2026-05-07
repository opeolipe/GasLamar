/**
 * config.js — GasLamar frontend configuration
 * Single source of truth for environment-specific settings.
 *
 * Staging Pages (staging.gaslamar.pages.dev) must call the staging worker so
 * that ENVIRONMENT="staging" is active and Mayar sandbox (api.mayar.club) is
 * used instead of the production gateway (api.mayar.id).
 *
 * Worker URLs:
 *   production : gaslamar.com (worker routes configured in wrangler.toml)
 *   staging    : api-staging.gaslamar.com
 */
const WORKER_URL = (() => {
  if (typeof window !== 'undefined' && window.location.hostname === 'staging.gaslamar.pages.dev') {
    return 'https://api-staging.gaslamar.com';
  }
  return 'https://gaslamar.com';
})();
