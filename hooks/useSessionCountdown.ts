import { useState, useEffect, useRef } from 'react';

export type CountdownVariant = 'default' | 'warning' | 'expired';

export interface SessionCountdown {
  text:           string;
  variant:        CountdownVariant;
  isExpiringSoon: boolean;
  isExpired:      boolean;
}

const SESSION_SECS = 7200; // 2 hours — matches worker cvtext_ TTL

export function useSessionCountdown(analyzeTime: number): SessionCountdown {
  const [, tick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!analyzeTime) return;
    intervalRef.current = setInterval(() => tick(n => n + 1), 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [analyzeTime]);

  if (!analyzeTime) {
    return { text: '', variant: 'default', isExpiringSoon: false, isExpired: false };
  }

  const remaining = SESSION_SECS - Math.floor((Date.now() - analyzeTime) / 1000);

  if (remaining <= 0) {
    return {
      text: 'Preview analisis sudah kedaluwarsa — hasil ini masih bisa kamu lihat, tapi tidak bisa lanjut bayar.',
      variant: 'expired',
      isExpiringSoon: false,
      isExpired: true,
    };
  }

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;

  if (remaining <= 300) {
    return {
      text: `⚠️ Preview berakhir dalam ${m}m ${s}s — selesaikan pembayaran sekarang!`,
      variant: 'warning',
      isExpiringSoon: true,
      isExpired: false,
    };
  }

  if (remaining <= 1800) {
    return {
      text: h > 0
        ? `⏰ Preview analisis berlaku ${h}j ${m}m lagi — bayar sebelum kedaluwarsa`
        : `⏰ Preview analisis berlaku ${m}m ${s}s lagi — bayar sebelum kedaluwarsa`,
      variant: 'warning',
      isExpiringSoon: false,
      isExpired: false,
    };
  }

  return {
    text: h > 0
      ? `⏰ Preview analisis berlaku ${h}j ${m}m lagi`
      : `⏰ Preview analisis berlaku ${m}m ${s}s lagi`,
    variant: 'default',
    isExpiringSoon: false,
    isExpired: false,
  };
}
