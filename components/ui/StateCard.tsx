interface Props {
  icon: React.ReactNode;
  title: string;
  message: string;
  helper?: string;
  children?: React.ReactNode;
  tone?: 'neutral' | 'warning' | 'danger';
}

const SHADOW = '0 18px 44px rgba(15, 23, 42, 0.08)';

export default function StateCard({ icon, title, message, helper, children, tone = 'neutral' }: Props) {
  const accent = tone === 'danger'
    ? { bg: 'rgba(254,242,242,0.9)', border: '1px solid rgba(239,68,68,0.18)' }
    : tone === 'warning'
    ? { bg: 'rgba(255,251,235,0.9)', border: '1px solid rgba(245,158,11,0.22)' }
    : { bg: 'rgba(239,246,255,0.9)', border: '1px solid rgba(59,130,246,0.18)' };
  return (
    <div
      data-testid="error-message"
      className="rounded-[24px] p-8 text-center"
      style={{
        background: 'rgba(255,255,255,0.88)',
        border: '1px solid rgba(148,163,184,0.14)',
        boxShadow: SHADOW,
        backdropFilter: 'blur(14px)',
      }}
    >
      <div
        className="w-16 h-16 rounded-[20px] flex items-center justify-center mx-auto mb-4"
        style={{ background: accent.bg, border: accent.border }}
        aria-hidden="true"
      >
        {icon}
      </div>
      <h2 className="text-lg font-semibold text-slate-900 mb-2" style={{ fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: '-0.02em' }}>
        {title}
      </h2>
      <p className="text-sm text-slate-500 mb-4 leading-relaxed max-w-sm mx-auto">{message}</p>
      {helper && <p className="text-sm text-slate-600 mb-6 leading-relaxed max-w-sm mx-auto">{helper}</p>}
      {children}
    </div>
  );
}
