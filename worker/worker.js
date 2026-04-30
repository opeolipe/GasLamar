/**
 * GasLamar Cloudflare Worker — Entry Point
 *
 * Endpoints:
 *   GET  /health          — Liveness check (no auth, no rate limit) — for uptime monitors
 *   POST /analyze         — CV scoring + gap analysis
 *   POST /create-payment  — Create Mayar invoice + KV session
 *   POST /webhook/mayar   — Receive Mayar webhook, update session status
 *   GET  /check-session   — Poll session status
 *   POST /get-session     — Retrieve CV data (post-payment, one-time)
 *   POST /generate        — Generate tailored CV via Claude API
 *
 * Environment variables (set via wrangler secret put):
 *   ANTHROPIC_API_KEY
 *   MAYAR_API_KEY
 *   MAYAR_API_KEY_SANDBOX
 *   MAYAR_WEBHOOK_SECRET
 *   ENVIRONMENT  ("production" | "sandbox")
 *
 * KV Binding: GASLAMAR_SESSIONS
 */

import { getCorsHeaders, isOriginAllowed, jsonResponse } from './src/cors.js';
import { route } from './src/router.js';

let coldStart = true;

export default {
  async fetch(request, env, ctx) {
    if (coldStart) {
      coldStart = false;
      console.log(JSON.stringify({
        event: 'worker_cold_start',
        environment: env.ENVIRONMENT ?? 'unknown',
        ts: Date.now(),
      }));
    }

    // Handle CORS preflight. Reject disallowed origins before any route logic runs.
    if (request.method === 'OPTIONS') {
      if (!isOriginAllowed(request, env)) {
        return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
      }
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request, env),
      });
    }

    try {
      return await route(request, env, ctx);
    } catch (err) {
      console.error('Unhandled error:', err);
      return jsonResponse({ message: 'Internal server error' }, 500, request, env);
    }
  },
};
