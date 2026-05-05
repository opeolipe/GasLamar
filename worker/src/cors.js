import { PRODUCTION_ORIGINS, STAGING_ORIGINS } from './constants.js';

export function getAllowedOrigins(env) {
  if (env.ENVIRONMENT === 'production') return PRODUCTION_ORIGINS;
  if (env.ENVIRONMENT === 'staging') return STAGING_ORIGINS;
  return PRODUCTION_ORIGINS; // sandbox and unknown environments mirror production
}

export function isOriginAllowed(request, env) {
  const origin = request.headers.get('Origin');
  return Boolean(origin && getAllowedOrigins(env).includes(origin));
}

export function getCorsHeaders(request, env) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Secret',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };

  const origin = request.headers.get('Origin');
  if (origin && getAllowedOrigins(env).includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
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
