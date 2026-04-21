interface Props {
  recommendations: string[];
  gaps:            string[];
}

export default function RewritePreview({ recommendations, gaps }: Props) {
  const allItems = [...recommendations, ...gaps];
  if (allItems.length < 2) return null;

  const first      = allItems[0];
  const rest       = allItems.slice(1, 5);
  const totalCount = allItems.length;

  function itemLabel(index: number): string {
    if (index < recommendations.length) return `✅ Perbaikan #${index + 1}`;
    return '❌ Gap yang diperbaiki';
  }

  return (
    <div style={{ background: 'linear-gradient(135deg,#F8FAFC 0%,#EFF6FF 100%)', borderRadius: 32, boxShadow: '0 8px 24px rgba(59,130,246,0.12), 0 1px 2px rgba(0,0,0,0.02)', padding: '2rem', border: '2px solid #3B82F6', marginBottom: '1.5rem', position: 'relative' }}>
      {/* "Pratinjau" badge */}
      <div style={{ position: 'absolute', top: -11, left: 20, background: '#3B82F6', color: 'white', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '0.2rem 0.85rem', borderRadius: 20 }}>
        Pratinjau
      </div>

      <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A', marginBottom: '0.2rem', margin: '0 0 0.2rem' }}>
        ✨ Pratinjau perbaikan CV kamu
      </h3>
      <p style={{ fontSize: '0.8rem', color: '#6B7280', marginBottom: '1rem', margin: '0 0 1rem' }}>
        AI akan terapkan semua perbaikan ini ke CV kamu secara langsung
      </p>

      {/* First item — fully visible */}
      <PreviewItem data-testid="rewrite-after" label="✅ Perbaikan #1 — contoh gratis" text={first} />

      {/* Remaining items — blurred with lock overlay */}
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ filter: 'blur(5px)', userSelect: 'none', pointerEvents: 'none' }}>
          {rest.map((item, i) => (
            <PreviewItem key={i} label={itemLabel(i + 1)} text={item} />
          ))}
          <div style={{ fontSize: '0.8rem', color: '#6B7280', textAlign: 'center', padding: '0.5rem 0 0.25rem' }}>
            + rewrite lengkap CV dalam Bahasa Indonesia &amp; Inggris
          </div>
        </div>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(248,250,252,0.72)', padding: '0.5rem' }}>
          <div style={{ background: '#0F172A', color: 'white', borderRadius: 60, padding: '0.6rem 1.1rem', fontSize: '0.8rem', fontWeight: 700, textAlign: 'center', lineHeight: 1.45, maxWidth: 280, boxShadow: '0 4px 16px rgba(15,23,42,0.18)' }}>
            🔒 Lihat semua {totalCount} perbaikan + CV rewrite lengkap (ID &amp; EN) setelah pilih paket
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewItem({ label, text, 'data-testid': testId }: { label: string; text: string; 'data-testid'?: string }) {
  return (
    <div data-testid={testId} style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderLeft: '3px solid #10B981', borderRadius: 12, padding: '0.85rem 1rem', marginBottom: '0.6rem' }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.88rem', color: '#111827', lineHeight: 1.55 }}>
        {text}
      </div>
    </div>
  );
}
