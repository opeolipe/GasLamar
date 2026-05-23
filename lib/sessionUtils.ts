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
  sessionStorage.removeItem('gaslamar_user_id');
  localStorage.removeItem('gaslamar_session');
  localStorage.removeItem('gaslamar_has_session');
  localStorage.removeItem('gaslamar_delivery');
  localStorage.removeItem('gaslamar_user_id');
  localStorage.removeItem('gaslamar_tier');
  if (sessionId) {
    sessionStorage.removeItem(`gaslamar_secret_${sessionId}`);
    localStorage.removeItem(`gaslamar_secret_${sessionId}`);
  }
}

const SECRET_PREFIX = 'gaslamar_secret_';
const SECRET_SEEN_PREFIX = 'gaslamar_secret_seen_';
const SECRET_GRACE_MS = 15 * 60 * 1000;

function cleanupSecretStorage(storage: Storage, activeSessionId: string, now: number): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(SECRET_PREFIX) && !key.startsWith(SECRET_SEEN_PREFIX)) keys.push(key);
  }

  for (const key of keys) {
    const secretSessionId = key.slice(SECRET_PREFIX.length);
    const seenKey = `${SECRET_SEEN_PREFIX}${secretSessionId}`;

    if (secretSessionId === activeSessionId) {
      storage.removeItem(seenKey);
      continue;
    }

    const firstSeen = Number(storage.getItem(seenKey) || 0);
    if (!firstSeen || Number.isNaN(firstSeen)) {
      storage.setItem(seenKey, String(now));
      continue;
    }

    if (now - firstSeen > SECRET_GRACE_MS) {
      storage.removeItem(key);
      storage.removeItem(seenKey);
    }
  }
}

function clearAllStoredSecrets(storage: Storage): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(SECRET_PREFIX) || key?.startsWith(SECRET_SEEN_PREFIX)) keys.push(key);
  }

  for (const key of keys) storage.removeItem(key);
}

export function cleanupStaleSessionSecrets(activeSessionId: string | null): void {
  if (!activeSessionId?.startsWith('sess_')) {
    try { clearAllStoredSecrets(sessionStorage); } catch (_) {}
    try { clearAllStoredSecrets(localStorage); } catch (_) {}
    return;
  }

  const now = Date.now();
  try { cleanupSecretStorage(sessionStorage, activeSessionId, now); } catch (_) {}
  try { cleanupSecretStorage(localStorage, activeSessionId, now); } catch (_) {}
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
