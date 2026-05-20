const EXPOSURE_PREFIX = 'gaslamar_exp_seen_';

function analytics(): any {
  return (window as any).Analytics;
}

function normalizeVariant(raw: unknown, fallback = 'control'): string {
  if (raw === true) return 'on';
  if (raw === false || raw == null) return fallback;
  return String(raw);
}

export function getExperimentVariant(flagKey: string, fallback = 'control'): string {
  try {
    const raw = analytics()?.getVariant?.(flagKey);
    return normalizeVariant(raw, fallback);
  } catch {
    return fallback;
  }
}

export function trackExperimentExposure(flagKey: string, variant: string): void {
  try {
    const key = `${EXPOSURE_PREFIX}${flagKey}`;
    const seen = sessionStorage.getItem(key);
    if (seen) return;
    sessionStorage.setItem(key, variant);
    analytics()?.track?.('experiment_exposure', { flag_key: flagKey, variant });
  } catch {
    // Ignore storage/analytics failures — experiments must never block UX.
  }
}
