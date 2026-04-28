import { useState, useEffect, useRef, useCallback } from 'react';
import {
  WORKER_URL,
  clearClientSessionData,
  getSessionSecret,
  buildSecretHeaders,
} from '@/lib/downloadUtils';

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
const MAX_POLLS          = 10;
const HEARTBEAT_INTERVAL = 3 * 60 * 1000;

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
  const pollCountRef      = useRef(0);
  const notFoundCountRef  = useRef(0);
  const pollTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef      = useRef<string | null>(null);
  const sessionSecretRef  = useRef<string | null>(null);
  const mountedRef        = useRef(true);
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

  function showError(title: string, message: string, retryable = false) {
    if (!mountedRef.current) return;
    setPhase('error');
    setError({ title, message, retryable });
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
          );
        }
      } catch (_) { /* ignore transient network errors */ }
    }, HEARTBEAT_INTERVAL);
  }

  // ── Polling ───────────────────────────────────────────────────────────────

  function scheduleNextPoll(sId: string) {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(() => poll(sId), POLL_INTERVAL);
  }

  async function poll(sId: string) {
    if (!mountedRef.current) return;
    pollCountRef.current++;

    // Update the status text on each tick
    if (notFoundCountRef.current > 0) {
      setStatusText(`Sesi belum ditemukan, mencoba lagi... (${notFoundCountRef.current}/4)`);
    } else {
      setStatusText('Memeriksa status pembayaran...');
    }

    try {
      const checkUrl = devModeRef.current
        ? `${WORKER_URL}/check-session?dev=1`
        : `${WORKER_URL}/check-session`;
      const res = await fetch(checkUrl, { credentials: 'include' });

      if (!mountedRef.current) return;

      if (res.status === 400) {
        showError('Link Tidak Valid', 'Link download tidak valid. Pastikan menggunakan link lengkap yang dikirim ke email kamu.');
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

      notFoundCountRef.current = 0;

      if (!res.ok) {
        if (pollCountRef.current < MAX_POLLS) {
          scheduleNextPoll(sId);
        } else {
          setShowCheckButton(true);
          setStatusText('Klik tombol di bawah untuk cek ulang.');
        }
        return;
      }

      const data     = await res.json() as { status: string; tier?: string; credits_remaining?: number; total_credits?: number; expires_at?: number };
      const { status } = data;

      if (status === 'paid' || status === 'generating') {
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

        // Returning multi-credit user: has used ≥1 credit already
        const isReturning = totalCredits > 1 && creditsRemaining < totalCredits;
        setPhase(isReturning ? 'returning' : 'confirmed');
        return;
      }

      if (status === 'pending') {
        if (pollCountRef.current >= MAX_POLLS) {
          ;(window as any).Analytics?.track?.('payment_timeout', { poll_attempts: pollCountRef.current });
          setShowCheckButton(true);
          setStatusText('Klik tombol di bawah untuk cek ulang.');
        } else {
          scheduleNextPoll(sId);
        }
        return;
      }

      // Unknown status — keep polling until MAX_POLLS
      if (pollCountRef.current < MAX_POLLS) {
        scheduleNextPoll(sId);
      } else {
        setShowCheckButton(true);
        setStatusText('Klik tombol di bawah untuk cek ulang.');
      }

    } catch (_) {
      if (pollCountRef.current < MAX_POLLS && mountedRef.current) {
        scheduleNextPoll(sId);
      }
    }
  }

  function startPolling(sId: string) {
    pollCountRef.current     = 0;
    notFoundCountRef.current = 0;
    setShowCheckButton(false);
    setStatusText('Memeriksa status pembayaran...');
    setPhase('waiting');
    // 2s initial delay absorbs Cloudflare KV eventual-consistency lag
    pollTimerRef.current = setTimeout(() => poll(sId), 2000);
  }

  // ── Manual check-now ──────────────────────────────────────────────────────

  const onCheckNow = useCallback(() => {
    const sId = sessionIdRef.current || sessionStorage.getItem('gaslamar_session');
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
    const sId = sessionStorage.getItem('gaslamar_session');
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
