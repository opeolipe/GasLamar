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

      {/* Share buttons */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
        {/* WhatsApp share */}
        <a
          href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Skor CV gue ${score}/100 di GasLamar — AI langsung tunjukin gap-nya vs job description. Coba cek CV kamu juga: https://gaslamar.com`)}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Bagikan skor ke WhatsApp"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #22C55E', color: '#16A34A', fontSize: '0.875rem', fontWeight: 600, padding: '0.5rem 1.1rem', borderRadius: 40, background: 'white', textDecoration: 'none', minHeight: 44, fontFamily: 'inherit', transition: 'background 0.2s' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          <span>WhatsApp</span>
        </a>

        {/* Generic share / copy */}
        <button
          onClick={handleShare}
          aria-label="Bagikan skor analisis CV"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #E2E8F0', color: copied ? '#059669' : '#4B5563', fontSize: '0.875rem', fontWeight: 600, padding: '0.5rem 1.1rem', borderRadius: 40, background: 'white', cursor: 'pointer', minHeight: 44, fontFamily: 'inherit', transition: 'border-color 0.2s, color 0.2s', borderColor: copied ? '#10B981' : '#E2E8F0' }}
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
    </div>
  );
}
