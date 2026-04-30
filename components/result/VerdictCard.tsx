import { VERDICT_CONFIG } from '@/lib/resultUtils';

interface Props {
  verdict:        'DO' | 'DO NOT' | 'TIMED';
  timeboxWeeks?:  number;
}

export default function VerdictCard({ verdict, timeboxWeeks }: Props) {
  const cfg = VERDICT_CONFIG[verdict];
  if (!cfg) return null;

  const desc = verdict === 'TIMED' && timeboxWeeks
    ? `Bisa dilamar setelah ${timeboxWeeks} minggu persiapan — perbaiki gap di bawah ini.`
    : verdict === 'TIMED'
    ? 'Ada gap signifikan tapi bisa diperbaiki. Fokus pada rekomendasi di bawah.'
    : cfg.desc;

  return (
    <div
      style={{ borderRadius: 10, padding: '0.6rem 1rem', margin: '0.5rem 0', fontSize: '0.875rem', fontWeight: 600, textAlign: 'center', background: cfg.bg, color: cfg.color, border: `1.5px solid ${cfg.border}` }}
    >
      <span style={{ fontSize: '1rem' }}>{cfg.icon}</span>{' '}
      <strong>{cfg.label}</strong>
      <br />
      <span style={{ fontWeight: 400, fontSize: '0.875rem' }}>{desc}</span>
    </div>
  );
}
