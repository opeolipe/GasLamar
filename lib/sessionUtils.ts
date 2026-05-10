import { WORKER_URL as PROD_WORKER_URL, SANDBOX_WORKER_URL } from '@/lib/uploadValidation';

// IS_SANDBOX is a build-time define injected by esbuild (true in staging, false in production).
// Keep API origin consistent with the worker that issued the session cookie.
declare const IS_SANDBOX: boolean;
export const WORKER_URL: string = IS_SANDBOX ? SANDBOX_WORKER_URL : PROD_WORKER_URL;

export const TIER_LABELS: Record<string, string> = {
  coba: 'Coba Dulu',
  single: 'Single',
  '3pack': '3-Pack',
  jobhunt: 'Job Hunt Pack',
};

export function isBilingual(tier: string): boolean {
  return tier !== 'coba';
}

export function isMultiCredit(tier: string): boolean {
  return tier === '3pack' || tier === 'jobhunt';
}

export function clearClientSessionData(sessionId: string | null): void {
  sessionStorage.removeItem('gaslamar_tier');
  sessionStorage.removeItem('gaslamar_session');
  localStorage.removeItem('gaslamar_session');
  localStorage.removeItem('gaslamar_tier');
  if (sessionId) {
    sessionStorage.removeItem(`gaslamar_secret_${sessionId}`);
    localStorage.removeItem(`gaslamar_secret_${sessionId}`);
  }
}

export function getSessionSecret(sessionId: string): string | null {
  return sessionStorage.getItem(`gaslamar_secret_${sessionId}`)
    ?? localStorage.getItem(`gaslamar_secret_${sessionId}`);
}

export function buildSecretHeaders(secret: string | null): Record<string, string> {
  return secret ? { 'X-Session-Secret': secret } : {};
}

export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}
