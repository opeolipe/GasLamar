interface Props {
  children: React.ReactNode;
  type?: 'info' | 'warning' | 'expired';
}

const STYLES: Record<NonNullable<Props['type']>, React.CSSProperties> = {
  info: {
    background:  'rgba(239,246,255,0.55)',
    borderColor: 'rgba(191,219,254,0.5)',
    color:       '#2563EB',
  },
  warning: {
    background:  'rgba(255,251,235,0.55)',
    borderColor: 'rgba(253,230,138,0.5)',
    color:       '#92400E',
  },
  expired: {
    background:  '#FEF2F2',
    borderColor: '#FECACA',
    color:       '#B91C1C',
  },
};

export default function InfoStrip({ children, type = 'info' }: Props) {
  const s = STYLES[type];
  return (
    <div
      role="status"
      style={{
        background:   s.background,
        color:        s.color,
        border:       `1px solid ${s.borderColor as string}`,
        borderRadius: 10,
        padding:      '0.5rem 1rem',
        fontSize:     '0.8rem',
        fontWeight:   400,
        textAlign:    'center',
        marginBottom: '1rem',
        lineHeight:   1.55,
      }}
    >
      {children}
    </div>
  );
}
