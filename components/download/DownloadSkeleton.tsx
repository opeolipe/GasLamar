import type { CSSProperties, ReactNode } from 'react';

const shimmerStyle: CSSProperties = {
  background: 'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%)',
  backgroundSize: '200% 100%',
  animation: 'glSkimmer 1.4s ease-in-out infinite',
  borderRadius: 10,
};

function Bar({ w, h = 12, className = '', style }: { w: number | string; h?: number; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={className}
      style={{ ...shimmerStyle, width: w, height: h, borderRadius: 8, flexShrink: 0, ...style }}
    />
  );
}

function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.88)',
        borderRadius: 24,
        border: '1px solid rgba(148,163,184,0.14)',
        boxShadow: '0 18px 44px rgba(15,23,42,0.05)',
        backdropFilter: 'blur(14px)',
        padding: '2rem',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function ButtonSkeleton() {
  return (
    <div style={{ ...shimmerStyle, height: 48, borderRadius: 12, width: '100%' }} />
  );
}

function AccordionRowSkeleton() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1rem',
        height: 52,
        borderRadius: 14,
        border: '1px solid rgba(148,163,184,0.16)',
        background: 'white',
        marginBottom: 8,
      }}
    >
      <Bar w="55%" h={12} />
      <div style={{ ...shimmerStyle, width: 16, height: 16, borderRadius: 4 }} />
    </div>
  );
}

export default function DownloadSkeleton() {
  return (
    <>
      <style>{`
        @keyframes glSkimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .gl-skeleton-card * { animation: none !important; }
        }
      `}</style>

      {/* Subtitle above card */}
      <div style={{ textAlign: 'center', marginBottom: '0.9rem' }}>
        <Bar w={280} h={12} className="inline-block" />
      </div>

      {/* Download card skeleton */}
      <Card style={{ padding: '2.15rem 2rem 1.8rem', marginBottom: '3.5rem' }}>
        <Bar w={60} h={10} style={{ marginBottom: '0.6rem' }} />
        <Bar w={260} h={22} style={{ marginBottom: '0.5rem' }} />
        <Bar w={200} h={13} style={{ marginBottom: '1.5rem' }} />

        {/* Responsive download grid: 1 col mobile, 2 col on sm+ (matches real layout) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <Bar w={120} h={10} style={{ marginBottom: '0.75rem' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ButtonSkeleton />
              <ButtonSkeleton />
            </div>
          </div>
          <div>
            <Bar w={80} h={10} style={{ marginBottom: '0.75rem' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ButtonSkeleton />
              <ButtonSkeleton />
            </div>
          </div>
        </div>
      </Card>

      {/* Interview Kit skeleton */}
      <Card style={{ marginBottom: '1.5rem' }}>
        <Bar w={140} h={20} style={{ marginBottom: '0.5rem' }} />
        <Bar w={260} h={12} style={{ marginBottom: '1.25rem' }} />

        {/* Language tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
          <div style={{ ...shimmerStyle, height: 36, width: 140, borderRadius: 20 }} />
          <div style={{ ...shimmerStyle, height: 36, width: 100, borderRadius: 20, opacity: 0.5 }} />
        </div>

        {[1, 2, 3, 4].map(i => (
          <AccordionRowSkeleton key={i} />
        ))}
      </Card>

      {/* Next steps skeleton */}
      <Card style={{ marginBottom: '1.5rem' }}>
        <Bar w={160} h={18} style={{ marginBottom: '1rem' }} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1, 2].map(i => (
            <div
              key={i}
              style={{
                borderRadius: 14,
                padding: '1rem',
                background: i === 1 ? '#EFF6FF' : '#F8FAFC',
                border: `1px solid ${i === 1 ? '#BFDBFE' : '#E2E8F0'}`,
              }}
            >
              <Bar w="70%" h={13} style={{ marginBottom: 8 }} />
              <Bar w="85%" h={10} />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
