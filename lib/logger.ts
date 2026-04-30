import { WORKER_URL } from '@/lib/uploadValidation';

export function logError(event: string, data?: Record<string, unknown>) {
  try {
    console.error('[ERROR]', event, data);
    const payload = JSON.stringify({ event, data, timestamp: Date.now() });
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon(`${WORKER_URL}/api/log`, blob);
    if ((window as any).Analytics?.track) {
      (window as any).Analytics.track('error_occurred', { event, ...data });
    }
  } catch {}
}
