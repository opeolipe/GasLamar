interface Props {
  children: React.ReactNode;
  type?: 'info' | 'warning' | 'expired';
}

const STYLES: Record<NonNullable<Props['type']>, React.CSSProperties> = {
  info: {
    background:  '#EFF6FF',
    borderColor: '#BFDBFE',
    color:       '#1E40AF',
  },
  warning: {
    background:  '#FFFBEB',
    borderColor: '#FDE68A',
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
        fontSize:     '0.82rem',
        fontWeight:   500,
        textAlign:    'center',
        marginBottom: '1rem',
        lineHeight:   1.55,
      }}
    >
      {children}
    </div>
  );
}
