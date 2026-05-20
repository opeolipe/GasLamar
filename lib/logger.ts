import { WORKER_URL } from '@/lib/sessionUtils';

export function logError(event: string, data?: Record<string, unknown>) {
  try {
    console.error('[ERROR]', event, data);
    const payload = JSON.stringify({ event, data, timestamp: Date.now() });
    // sendBeacon with a plain string sends Content-Type: text/plain — a CORS "simple"
    // request that requires no preflight OPTIONS. Using Blob(application/json) would
    // trigger a preflight; if that preflight raced or failed the log would be silently
    // dropped and monitoring tools would attribute the failure to the current page URL.
    navigator.sendBeacon(`${WORKER_URL}/api/log`, payload);
    if ((window as any).Analytics?.track) {
      (window as any).Analytics.track('error_occurred', { event, ...data });
    }
  } catch {}
}
