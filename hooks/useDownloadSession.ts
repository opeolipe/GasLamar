import { useState, useEffect, useRef, useCallback } from 'react';
import {
  WORKER_URL,
  clearClientSessionData,
  getSessionSecret,
  buildSecretHeaders,
} from '@/lib/sessionUtils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionData {
  tier:             string;
  creditsRemaining: number;
  totalCredits:     number;
  expiresAt:        number | null;
}

export interface SessionError {
  title:     string;
  message:   string;
  retryable: boolean;
  reason?:   string;
}

export type SessionPhase = 'init' | 'waiting' | 'confirmed' | 'returning' | 'error';

export interface UseDownloadSessionReturn {
  phase:           SessionPhase;
  sessionId:       string | null;
  sessionSecret:   string | null;
  sessionData:     SessionData | null;
  statusText:      string;
  showCheckButton: boolean;
  error:           SessionError | null;
  onCheckNow:      () => void;
  startHeartbeat:  (totalCredits: number) => void;
  stopHeartbeat:   () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL      = 3000;
const MAX_POLLS          = 20; // 60 s auto-polling window (+2 s initial delay)
const HEARTBEAT_INTERVAL = 3 * 60 * 1000;
// After this many consecutive 401s, stop polling and show access-recovery UI.
// 401 is not transient — it means auth is broken in this browser context.
const MAX_AUTH_FAILURES  = 2;

function getBackoffDelay(pollCount: number): number {
  return Math.min(POLL_INTERVAL * Math.pow(1.3, Math.max(0, pollCount - 1)), 8000);
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useDownloadSession(): UseDownloadSessionReturn {
  const [phase,           setPhase]           = useState<SessionPhase>('init');
  const [sessionId,       setSessionId]       = useState<string | null>(null);
  const [sessionSecret,   setSessionSecret]   = useState<string | null>(null);
  const [sessionData,     setSessionData]     = useState<SessionData | null>(null);
  const [statusText,      setStatusText]      = useState('Memeriksa status pembayaran...');
  const [showCheckButton, setShowCheckButton] = useState(false);
  const [error,           setError]           = useState<SessionError | null>(null);

  // Refs — mutated inside timer callbacks without causing re-renders
  const pollCountRef          = useRef(0);
  const notFoundCountRef      = useRef(0);
  const authFailureCountRef   = useRef(0); // consecutive 401s — resets on any non-401
  const pollTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef          = useRef<string | null>(null);
  const sessionSecretRef      = useRef<string | null>(null);
  const mountedRef            = useRef(true);
  // Set to true on staging hostname or when ?dev=1 is in the URL. Captured at
  // init time before history.replaceState strips the token query param.
  const devModeRef        = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      stopHeartbeat();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Error helper ──────────────────────────────────────────────────────────

  function showError(title: string, message: string, retryable = false, reason?: string) {
    if (!mountedRef.current) return;
    setPhase('error');
    setError({ title, message, retryable, ...(reason ? { reason } : {}) });
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  function stopHeartbeat() {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }

  function startHeartbeat(totalCredits: number) {
    if (heartbeatTimerRef.current) return; // already running
    const label = totalCredits > 1 ? '30 hari' : '7 hari';

    heartbeatTimerRef.current = setInterval(async () => {
      if (!mountedRef.current) { stopHeartbeat(); return; }
      try {
        const res = await fetch(`${WORKER_URL}/session/ping`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', ...buildSecretHeaders(sessionSecretRef.current) },
          credentials: 'include',
        });
        if (res.status === 404 && mountedRef.current) {
          stopHeartbeat();
          clearClientSessionData(sessionIdRef.current);
          showError(
            'Sesi Kedaluwarsa',
            `📅 Sesi download kamu sudah berakhir (berlaku ${label}). Upload ulang CV untuk memulai analisis baru, atau hubungi support@gaslamar.com jika kamu masih punya kredit tersisa.`,
            false,
            'expired',
          );
        }
      } catch (_) { /* ignore transient network errors */ }
    }, HEARTBEAT_INTERVAL);
  }

  // ── Polling ───────────────────────────────────────────────────────────────

  function scheduleNextPoll(sId: string, delay = POLL_INTERVAL) {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(() => poll(sId), delay);
  }

  async function poll(sId: string) {
    if (!mountedRef.current) return;

    // Guard against a corrupted session ID reaching the server
    if (!sId || !sId.startsWith('sess_') || sId.length < 10) {
      showError('Sesi tidak valid', 'ID sesi tidak valid. Coba lagi dari awal.');
      return;
    }

    pollCountRef.current++;

    // Update the status text on each tick
    if (notFoundCountRef.current > 0) {
      setStatusText(`Sesi belum ditemukan, mencoba lagi... (${notFoundCountRef.current}/4)`);
    } else {
      setStatusText('Memeriksa status pembayaran...');
    }

    try {
      // Send session ID as query param so check-session can resolve the session even
      // when the cross-site HttpOnly cookie is blocked (e.g. Safari ITP / private mode).
      const sessionParam = encodeURIComponent(sId);
      const checkUrl = devModeRef.current
        ? `${WORKER_URL}/check-session?dev=1&session=${sessionParam}`
        : `${WORKER_URL}/check-session?session=${sessionParam}`;
      const res = await fetch(checkUrl, { credentials: 'include' });

      if (!mountedRef.current) return;

      if (res.status === 400) {
        showError('Link Tidak Valid', 'Link download tidak valid. Pastikan menggunakan link lengkap yang dikirim ke email kamu.');
        return;
      }

      // 401 means auth is broken in this browser context (no cookie, no session param).
      // This is not a transient error — stop the spinner immediately and show recovery.
      if (res.status === 401) {
        authFailureCountRef.current++;
        if (authFailureCountRef.current >= MAX_AUTH_FAILURES) {
          showError(
            'Sesi tidak bisa dibuka di browser ini',
            'Buka ulang dari link email atau minta link baru di halaman akses.',
            false,
            'auth_failure',
          );
        } else {
          scheduleNextPoll(sId, getBackoffDelay(pollCountRef.current));
        }
        return;
      }

      if (res.status === 404) {
        notFoundCountRef.current++;
        setStatusText(`Sesi belum ditemukan, mencoba lagi... (${notFoundCountRef.current}/4)`);
        if (notFoundCountRef.current < 4) {
          scheduleNextPoll(sId);
          return;
        }
        clearClientSessionData(sId);
        showError(
          'Sesi Tidak Ditemukan',
          'Sesi pembayaran tidak ditemukan. Jika kamu baru saja membayar, coba refresh halaman ini — kadang butuh 1–2 menit. Jika masalah berlanjut, hubungi support@gaslamar.com dengan bukti pembayaran.',
        );
        return;
      }

      notFoundCountRef.current  = 0;
      authFailureCountRef.current = 0; // reset on any successful (non-401) response

      if (!res.ok) {
        if (pollCountRef.current < MAX_POLLS) {
          scheduleNextPoll(sId, getBackoffDelay(pollCountRef.current));
        } else {
          setShowCheckButton(true);
          setStatusText('Pembayaran belum terkonfirmasi. Jika kamu sudah membayar, tunggu beberapa saat lalu muat ulang halaman ini.');
        }
        return;
      }

      const data     = await res.json() as { status: string; tier?: string; credits_remaining?: number; total_credits?: number; expires_at?: number };
      const { status } = data;

      // Non-blocking debug log so the payment flow can be traced in browser DevTools
      if (status !== 'paid' && status !== 'generating') {
        console.debug('[GasLamar] check-session:', { status, poll: pollCountRef.current, maxPolls: MAX_POLLS });
      }

      // paid/generating/ready all mean "payment confirmed, proceed to generation or dashboard"
      if (status === 'paid' || status === 'generating' || status === 'ready') {
        if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }

        const creditsRemaining = data.credits_remaining ?? 1;
        const totalCredits     = data.total_credits     ?? 1;
        const tier             = data.tier              ?? 'single';
        const expiresAt        = data.expires_at        ?? null;

        sessionStorage.setItem('gaslamar_tier', tier);

        ;(window as any).Analytics?.track?.('payment_confirmed', {
          tier,
          total_credits:  totalCredits,
          poll_attempts:  pollCountRef.current,
        });

        setSessionData({ tier, creditsRemaining, totalCredits, expiresAt });

        // Returning multi-credit user: has used ≥1 credit already (ready state or
        // re-visiting after a previous successful generation)
        const isReturning = totalCredits > 1 && creditsRemaining < totalCredits;
        setPhase(isReturning ? 'returning' : 'confirmed');
        return;
      }

      // exhausted = all credits consumed; session + cv_result_ preserved for 30 days.
      // Do NOT clear client session data — the user can still access their generated
      // CV by navigating back (e.g. via the email link). Clearing localStorage here
      // would block re-entry by sending them to access.html on the next visit.
      if (status === 'exhausted') {
        if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
        ;(window as any).Analytics?.track?.('download_session_exhausted', { poll_attempts: pollCountRef.current });
        showError(
          'Kredit Habis',
          'Semua kredit kamu sudah digunakan. CV kamu masih tersimpan — cek email kamu untuk link download, atau hubungi support@gaslamar.com.',
        );
        return;
      }

      // pending_payment (new name) and pending (legacy) both mean awaiting webhook
      if (status === 'pending_payment' || status === 'pending') {
        if (pollCountRef.current >= MAX_POLLS) {
          ;(window as any).Analytics?.track?.('payment_timeout', { poll_attempts: pollCountRef.current });
          setShowCheckButton(true);
          setStatusText('Pembayaran belum terkonfirmasi. Jika kamu sudah membayar, tunggu beberapa saat lalu muat ulang halaman ini.');
        } else {
          scheduleNextPoll(sId, getBackoffDelay(pollCountRef.current));
        }
        return;
      }

      // Session fully consumed in old format
      if (status === 'deleted') {
        clearClientSessionData(sId);
        ;(window as any).Analytics?.track?.('download_session_deleted', { poll_attempts: pollCountRef.current });
        showError(
          'CV Sudah Diunduh',
          'Semua kredit kamu sudah digunakan. Untuk menganalisis CV berikutnya, upload ulang di halaman utama.',
        );
        return;
      }

      // Unknown status — keep polling until MAX_POLLS
      if (pollCountRef.current < MAX_POLLS) {
        scheduleNextPoll(sId, getBackoffDelay(pollCountRef.current));
      } else {
        setShowCheckButton(true);
        setStatusText('Klik tombol di bawah untuk cek ulang.');
      }

    } catch (_) {
      if (pollCountRef.current < MAX_POLLS && mountedRef.current) {
        scheduleNextPoll(sId, getBackoffDelay(pollCountRef.current));
      }
    }
  }

  function startPolling(sId: string) {
    pollCountRef.current        = 0;
    notFoundCountRef.current    = 0;
    authFailureCountRef.current = 0;
    setShowCheckButton(false);
    setStatusText('Memeriksa status pembayaran...');
    setPhase('waiting');
    // 2s initial delay absorbs Cloudflare KV eventual-consistency lag
    pollTimerRef.current = setTimeout(() => poll(sId), 2000);
  }

  // ── Manual check-now ──────────────────────────────────────────────────────

  const onCheckNow = useCallback(() => {
    const sId = sessionIdRef.current
             || sessionStorage.getItem('gaslamar_session')
             || localStorage.getItem('gaslamar_session');
    if (!sId) {
      showError('Sesi tidak ditemukan', 'Link download tidak valid.');
      return;
    }
    setShowCheckButton(false);
    startPolling(sId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Initialization ────────────────────────────────────────────────────────

  useEffect(() => {
    const params     = new URLSearchParams(location.search);
    const emailToken = params.get('token');

    // Detect dev/staging mode before history.replaceState strips query params.
    devModeRef.current =
      window.location.hostname.includes('staging') ||
      params.get('dev') === '1';

    // ── Path 1: email link with ?token= ──────────────────────────────────────
    if (emailToken) {
      setPhase('waiting');

      (async () => {
        try {
          const res = await fetch(`${WORKER_URL}/exchange-token`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email_token: emailToken }),
          });
          if (!mountedRef.current) return;

          if (res.ok) {
            const data = await res.json() as { session_id?: string };
            if (data.session_id) {
              sessionStorage.setItem('gaslamar_session', data.session_id);
              sessionIdRef.current     = data.session_id;
              sessionSecretRef.current = getSessionSecret(data.session_id);
              setSessionId(data.session_id);
              setSessionSecret(sessionSecretRef.current);
            }
            history.replaceState(null, '', location.pathname);
            startPolling(sessionIdRef.current!);
          } else {
            showError(
              'Link Kedaluwarsa',
              'Link dari email sudah tidak berlaku (maksimal 1 jam). Gunakan link dari email terbaru, atau mulai ulang dari halaman upload.',
              false,
              'expired',
            );
          }
        } catch (_) {
          if (mountedRef.current) {
            showError('Terjadi Kesalahan', 'Tidak dapat menghubungi server. Coba refresh halaman ini.');
          }
        }
      })();
      return;
    }

    // ── Path 2: sessionStorage (normal post-payment flow) ────────────────────
    // Fall back to localStorage: Result.tsx writes to both storages, but if
    // Mayar redirected in a new tab, sessionStorage for this origin was never
    // populated. localStorage survives cross-tab navigation.
    const sId = sessionStorage.getItem('gaslamar_session')
             ?? localStorage.getItem('gaslamar_session');
    if (!sId || !sId.startsWith('sess_')) {
      showError('Sesi tidak ditemukan', 'Link download tidak valid. Coba lagi dari awal.');
      return;
    }

    const secret         = getSessionSecret(sId);
    sessionIdRef.current     = sId;
    sessionSecretRef.current = secret;
    setSessionId(sId);
    setSessionSecret(secret);
    startPolling(sId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    phase,
    sessionId,
    sessionSecret,
    sessionData,
    statusText,
    showCheckButton,
    error,
    onCheckNow,
    startHeartbeat,
    stopHeartbeat,
  };
}
