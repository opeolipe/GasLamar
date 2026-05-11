interface Props {
  recommendations: string[];
  gaps:            string[];
}

export default function RewritePreview({ recommendations, gaps }: Props) {
  const allItems = [...recommendations, ...gaps];
  if (allItems.length < 2) return null;

  const first      = allItems[0];
  // Show only 2 blurred items max (was 4) to cut height ~40%
  const rest       = allItems.slice(1, 3);
  const totalCount = allItems.length;

  function itemLabel(index: number): string {
    if (index < recommendations.length) return `Perbaikan #${index + 1}`;
    return 'Gap yang diperbaiki';
  }

  return (
    <div style={{ background: 'linear-gradient(135deg,#F8FAFC 0%,#EFF6FF 100%)', borderRadius: 20, boxShadow: '0 4px 16px rgba(59,130,246,0.10)', padding: '1.25rem', border: '2px solid #3B82F6', marginBottom: '1.5rem', position: 'relative' }}>
      <div style={{ position: 'absolute', top: -11, left: 20, background: '#3B82F6', color: 'white', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '0.18rem 0.75rem', borderRadius: 20 }}>
        Pratinjau
      </div>

      <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: '0 0 0.15rem' }}>
        ✨ Pratinjau perbaikan CV kamu
      </h3>
      <p style={{ fontSize: '0.8rem', color: '#6B7280', margin: '0 0 0.85rem' }}>
        AI akan terapkan semua perbaikan ini ke CV kamu secara langsung
      </p>

      {/* First item — fully visible */}
      <PreviewItem label="✅ Perbaikan #1 — contoh gratis" text={first} />

      {/* Remaining — blurred with lock overlay */}
      <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ filter: 'blur(4px)', userSelect: 'none', pointerEvents: 'none' }}>
          {rest.map((item, i) => (
            <PreviewItem key={i} label={itemLabel(i + 1)} text={item} />
          ))}
          <div style={{ fontSize: '0.8rem', color: '#6B7280', textAlign: 'center', padding: '0.25rem 0' }}>
            + rewrite lengkap CV dalam Bahasa Indonesia &amp; Inggris
          </div>
        </div>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(248,250,252,0.75)', padding: '0.5rem' }}>
          <div style={{ background: '#1E40AF', color: 'white', borderRadius: 60, padding: '0.55rem 1rem', fontSize: '0.8rem', fontWeight: 700, textAlign: 'center', lineHeight: 1.4, maxWidth: 260, boxShadow: '0 4px 14px rgba(37,99,235,0.25)' }}>
            🔒 Lihat semua {totalCount} perbaikan + CV rewrite lengkap (ID &amp; EN) setelah pilih paket
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewItem({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderLeft: '3px solid #10B981', borderRadius: 10, padding: '0.65rem 0.85rem', marginBottom: '0.5rem' }}>
      <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.25rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.82rem', color: '#111827', lineHeight: 1.5 }}>
        {text}
      </div>
    </div>
  );
}
