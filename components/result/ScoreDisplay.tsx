import { useState, useEffect } from 'react';
import Tooltip                  from '@/components/result/Tooltip';
import { scoreBadge, scoreRingColor, guidingSentence } from '@/lib/resultUtils';

interface Props {
  score:      number;
  archetype?: string;
  gapCount:   number;
}

const CIRCUMFERENCE = 534; // 2π × r85

export default function ScoreDisplay({ score, archetype, gapCount }: Props) {
  const [offset,    setOffset]    = useState(CIRCUMFERENCE);
  const [announced, setAnnounced] = useState('');
  const [copied,    setCopied]    = useState(false);

  const badge     = scoreBadge(score);
  const ringColor = scoreRingColor(score);
  const sentence  = guidingSentence(gapCount);

  // Animate ring fill on mount
  useEffect(() => {
    const id = setTimeout(() => {
      setOffset(CIRCUMFERENCE - (score / 100) * CIRCUMFERENCE);
    }, 100);
    return () => clearTimeout(id);
  }, [score]);

  // Announce score to screen readers after animation completes
  useEffect(() => {
    const id = setTimeout(() => setAnnounced(`Skor kamu: ${score} dari 100`), 1300);
    return () => clearTimeout(id);
  }, [score]);

  async function handleShare() {
    const shareText = `Skor CV gue ${score}/100 di GasLamar — AI langsung tunjukin gap-nya vs job description. Coba cek CV kamu juga 👇`;
    const shareUrl  = 'https://gaslamar.com';

    if (navigator.share) {
      try {
        await navigator.share({ title: 'GasLamar — Cek Skor CV Kamu', text: shareText, url: shareUrl });
        return;
      } catch (e: any) {
        if (e.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_) {
      window.open(
        `https://x.com/intent/post?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`,
        '_blank', 'noopener,noreferrer',
      );
    }
  }

  return (
    <div className="text-center my-4">
      {/* SR live region */}
      <span className="sr-only" aria-live="polite">{announced}</span>

      {/* Score ring */}
      <div aria-hidden="true" style={{ position: 'relative', width: 150, height: 150, margin: '0 auto 1rem' }}>
        <svg viewBox="0 0 190 190" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
          <circle cx="95" cy="95" r="85" fill="none" stroke="#E5E7EB" strokeWidth="12" />
          <circle
            cx="95" cy="95" r="85"
            fill="none"
            stroke={ringColor}
            strokeWidth="12"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s ease' }}
          />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'center', marginBottom: '0.1rem', lineHeight: 1.2 }}>
            Peluang Interview
            <Tooltip text="Estimasi peluang kamu dipanggil HR berdasarkan seberapa cocok CV-mu dengan lowongan. Skor 70+ = peluang tinggi." />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <span style={{ fontSize: '2.8rem', fontWeight: 800, lineHeight: 1, color: '#111827' }}>{score}</span>
            <span style={{ fontSize: '0.9rem', color: '#5B6E8C' }}>%</span>
          </div>
        </div>
      </div>

      {/* Archetype badge */}
      {archetype && (
        <div style={{ display: 'inline-block', fontSize: '0.875rem', fontWeight: 600, borderRadius: 20, padding: '0.2rem 0.8rem', background: '#EFF6FF', color: '#1D4ED8', marginBottom: '0.4rem' }}>
          {archetype}
        </div>
      )}

      {/* Score status badge */}
      <div style={{ display: 'inline-block', padding: '0.25rem 1rem', borderRadius: 60, fontSize: '0.875rem', fontWeight: 600, marginTop: '0.5rem', background: badge.bg, color: badge.textColor }}>
        {badge.text}
      </div>

      {/* Guiding sentence */}
      {sentence && (
        <p style={{ fontSize: '0.88rem', color: '#374151', fontWeight: 500, maxWidth: 380, margin: '0.5rem auto 0' }}>
          {sentence}
        </p>
      )}

      {/* Share button */}
      <button
        onClick={handleShare}
        aria-label="Bagikan skor analisis CV"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #E2E8F0', color: copied ? '#059669' : '#4B5563', fontSize: '0.875rem', fontWeight: 600, padding: '0.5rem 1.1rem', borderRadius: 40, background: 'white', cursor: 'pointer', marginTop: '1rem', minHeight: 44, fontFamily: 'inherit', transition: 'border-color 0.2s, color 0.2s', borderColor: copied ? '#10B981' : '#E2E8F0' }}
      >
        {copied ? (
          <span>✓ Teks skor disalin!</span>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
            </svg>
            <span>Bagikan Skor</span>
          </>
        )}
      </button>
    </div>
  );
}
