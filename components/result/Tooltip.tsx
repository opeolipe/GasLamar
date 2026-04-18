import { useState } from 'react';

interface Props { text: string }

export default function Tooltip({ text }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <span
      role="tooltip"
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'help', marginLeft: 4, verticalAlign: 'middle' }}
    >
      <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94A3B8', background: '#F1F5F9', borderRadius: '50%', width: 15, height: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0 }}>
        ?
      </span>
      {open && (
        <span
          aria-live="polite"
          style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', background: '#1E293B', color: '#fff', fontSize: '0.75rem', fontWeight: 400, borderRadius: 8, padding: '0.5rem 0.75rem', width: 220, textAlign: 'center', zIndex: 200, pointerEvents: 'none', lineHeight: 1.4, whiteSpace: 'normal' }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
