// ---- CORS Origins ----

export const PRODUCTION_ORIGINS = [
  'https://gaslamar.com',
  'https://www.gaslamar.com',
  'https://gaslamar.pages.dev', // Cloudflare Pages canonical URL (non-staging)
];

export const STAGING_ORIGINS = [
  'https://staging.gaslamar.pages.dev',
  'http://localhost:3000',
];

// ---- Tier Config ----

export const TIER_PRICES = {
  coba:    { label: 'GasLamar — Coba Dulu',      amount: 29000  },
  single:  { label: 'GasLamar — Single',         amount: 59000  },
  '3pack': { label: 'GasLamar — 3-Pack',         amount: 149000 },
  jobhunt: { label: 'GasLamar — Job Hunt Pack',  amount: 299000 },
};

// Number of CV generations included per tier
export const TIER_CREDITS = {
  coba:    1,
  single:  1,
  '3pack': 3,
  jobhunt: 10,
};

// ---- Session TTL ----

export const SESSION_TTL       = 604800;   // 7 days — single-credit paid sessions (single / coba dulu)
export const SESSION_TTL_MULTI = 2592000;  // 30 days — 3-Pack / Job Hunt Pack

// ---- KV Key Prefixes ----

export const KV_CV_RESULT_PREFIX = 'cv_result_';
