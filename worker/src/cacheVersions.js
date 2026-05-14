// Central cache-key versions.
// Bump these when prompt/scoring logic changes to avoid stale KV cache hits.

export const EXTRACT_CACHE_VERSION = 'v5';
export const ANALYSIS_CACHE_VERSION = 'v15';

// Prefixes intentionally include trailing underscore.
export const GEN_KEY_PREFIX_ID = 'gen_id_v4_';
export const GEN_KEY_PREFIX_EN = 'gen_en_v4_';
