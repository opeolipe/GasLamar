export function logError(event: string, data?: Record<string, unknown>) {
  try {
    console.error('[ERROR]', event, data);
    const payload = JSON.stringify({ event, data, timestamp: Date.now() });
    navigator.sendBeacon('/api/log', payload);
    if ((window as any).Analytics?.track) {
      (window as any).Analytics.track('error_occurred', { event, ...data });
    }
  } catch {}
}
