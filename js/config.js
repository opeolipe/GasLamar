/**
 * config.js — GasLamar frontend configuration
 * Single source of truth for environment-specific settings.
 *
 * Staging Pages (staging.gaslamar.pages.dev) must call the staging worker so
 * that ENVIRONMENT="staging" is active and Mayar sandbox (api.mayar.club) is
 * used instead of the production gateway (api.mayar.id).
 *
 * Worker URLs:
 *   production : gaslamar-worker.carolineratuolivia.workers.dev
 *   staging    : gaslamar-worker-staging.carolineratuolivia.workers.dev
 */
const WORKER_URL = (() => {
  if (typeof window !== 'undefined' && window.location.hostname === 'staging.gaslamar.pages.dev') {
    return 'https://gaslamar-worker-staging.carolineratuolivia.workers.dev';
  }
  return 'https://gaslamar-worker.carolineratuolivia.workers.dev';
})();
