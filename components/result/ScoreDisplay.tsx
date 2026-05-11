import { useState, useEffect, useRef } from 'react';
import Tooltip                  from '@/components/result/Tooltip';
import { scoreRingColor }       from '@/lib/resultUtils';

interface Props {
  score: number;
}

const CIRCUMFERENCE = 534;

export default function ScoreDisplay({ score }: Props) {
  const prefersReducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [offset,    setOffset]    = useState(CIRCUMFERENCE);
  const [announced, setAnnounced] = useState('');

  const ringColor = scoreRingColor(score);

  useEffect(() => {
    if (prefersReducedMotion.current) {
      setOffset(CIRCUMFERENCE - (score / 100) * CIRCUMFERENCE);
      return;
    }
    const id = setTimeout(() => {
      setOffset(CIRCUMFERENCE - (score / 100) * CIRCUMFERENCE);
    }, 100);
    return () => clearTimeout(id);
  }, [score]);

  useEffect(() => {
    const id = setTimeout(() => setAnnounced(`Skor kamu: ${score} dari 100`), 1300);
    return () => clearTimeout(id);
  }, [score]);

  return (
    <div className="text-center my-4">
      <span className="sr-only" aria-live="polite">{announced}</span>

      <div aria-hidden="true" style={{ position: 'relative', width: 140, height: 140, margin: '0 auto' }}>
        <svg viewBox="0 0 190 190" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
          <circle cx="95" cy="95" r="85" fill="none" stroke="#E5E7EB" strokeWidth="10" />
          <circle
            cx="95" cy="95" r="85"
            fill="none"
            stroke={ringColor}
            strokeWidth="10"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: prefersReducedMotion.current ? 'none' : 'stroke-dashoffset 1.2s cubic-bezier(0.22,1,0.36,1)' }}
          />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: '0.58rem', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center', marginBottom: '0.1rem', lineHeight: 1.3, maxWidth: 88, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
            Seberapa cocok CV kamu
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <span style={{ fontSize: '2.6rem', fontWeight: 800, lineHeight: 1, color: '#111827' }}>{score}</span>
            <span style={{ fontSize: '0.85rem', color: '#9CA3AF' }}>%</span>
          </div>
        </div>
      </div>
      {/* Tooltip placed outside aria-hidden so keyboard + screen reader users can access it */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.25rem' }}>
        <Tooltip text="Estimasi seberapa siap CV kamu bersaing di posisi ini. Skor 70+ = peluang tinggi dipanggil HR." />
      </div>
    </div>
  );
}
