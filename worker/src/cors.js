import { PRODUCTION_ORIGINS, STAGING_ORIGINS } from './constants.js';

export function getAllowedOrigins(env) {
  if (env.ENVIRONMENT === 'production') return PRODUCTION_ORIGINS;
  if (env.ENVIRONMENT === 'staging') return STAGING_ORIGINS;
  // Sandbox covers both CI (no browser, CORS irrelevant) and local browser dev (localhost:3000).
  // Include both sets so wrangler dev with a localhost frontend works without CORS errors.
  if (env.ENVIRONMENT === 'sandbox') return [...PRODUCTION_ORIGINS, ...STAGING_ORIGINS];
  // C1 FIX: Any value other than the three known environments is a misconfiguration.
  // Silently mirroring production for an unknown env (e.g. a typo like "prodution")
  // could grant unexpected CORS access without operator awareness. Fail closed so the
  // misconfiguration is immediately visible in logs/startup errors.
  throw new Error(`Unknown ENVIRONMENT value: "${env.ENVIRONMENT ?? '(undefined)'}". Expected 'production', 'staging', or 'sandbox'.`);
}

export function isOriginAllowed(request, env) {
  const origin = request.headers.get('Origin');
  return Boolean(origin && getAllowedOrigins(env).includes(origin));
}

export function isUnsafeOrigin(request, env) {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;

  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');

  if (origin) return origin === 'null' || !getAllowedOrigins(env).includes(origin);
  return fetchSite === 'cross-site';
}

export function forbiddenOriginResponse(request, env) {
  return jsonResponse({ message: 'Forbidden origin' }, 403, request, env);
}

export function getCorsHeaders(request, env) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Id',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };

  const origin = request.headers.get('Origin');
  // Explicitly exclude the string "null" (sent by opaque origins / sandboxed iframes).
  // Setting Access-Control-Allow-Origin: null can be interpreted permissively by some browsers.
  if (origin && origin !== 'null' && getAllowedOrigins(env).includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cache-Control': 'no-store',
};

export function corsResponse(body, status, headers, request, env) {
  const corsHeaders = getCorsHeaders(request, env);
  return new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, ...corsHeaders, ...headers }
  });
}

export function jsonResponse(data, status = 200, request, env) {
  return corsResponse(
    JSON.stringify(data),
    status,
    { 'Content-Type': 'application/json' },
    request,
    env
  );
}

export function jsonResponseWithCookie(data, status, cookieHeader, request, env) {
  return corsResponse(
    JSON.stringify(data),
    status,
    { 'Content-Type': 'application/json', 'Set-Cookie': cookieHeader },
    request,
    env
  );
}
