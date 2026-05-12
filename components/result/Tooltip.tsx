import { useState, useId } from 'react';

interface Props { text: string }

export default function Tooltip({ text }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const popupId = `tooltip-${id}`;

  function toggle() { setOpen(v => !v); }

  return (
    <span
      tabIndex={0}
      role="button"
      aria-label="Informasi tambahan"
      aria-expanded={open}
      aria-controls={popupId}
      onClick={toggle}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'help', marginLeft: 4, verticalAlign: 'middle', minWidth: 44, minHeight: 44 }}
    >
      <span aria-hidden="true" style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94A3B8', background: '#F1F5F9', borderRadius: '50%', width: 15, height: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0, pointerEvents: 'none' }}>
        ?
      </span>
      <span
        id={popupId}
        role="tooltip"
        style={{
          position:   'absolute',
          bottom:     'calc(100% + 6px)',
          left:       '50%',
          transform:  'translateX(-50%)',
          background: '#1E293B',
          color:      '#fff',
          fontSize:   '0.875rem',
          fontWeight: 400,
          borderRadius: 8,
          padding:    '0.5rem 0.75rem',
          width:      'max-content',
          maxWidth:   'min(220px, calc(100vw - 2rem))',
          textAlign:  'center',
          zIndex:     200,
          pointerEvents: 'none',
          lineHeight: 1.4,
          whiteSpace: 'normal',
          visibility: open ? 'visible' : 'hidden',
        }}
      >
        {text}
      </span>
    </span>
  );
}
