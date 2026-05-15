import type { CSSProperties } from 'react';

export const PAGE_BG = 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(37,99,235,0.08), transparent)';

export const NAV_STYLE: CSSProperties = {
  background: 'rgba(255,255,255,0.88)',
  borderBottom: '1px solid rgba(148,163,184,0.18)',
  backdropFilter: 'blur(14px)',
};

export const CARD_STYLE: CSSProperties = {
  background: 'rgba(255,255,255,0.92)',
  borderRadius: 24,
  boxShadow: '0 18px 44px rgba(15,23,42,0.07), 0 1px 2px rgba(15,23,42,0.04)',
  padding: '2rem',
  border: '1px solid rgba(148,163,184,0.14)',
  backdropFilter: 'blur(14px)',
  marginBottom: '1.75rem',
};

export const SECTION_HEADING: CSSProperties = {
  fontSize: '1.1rem',
  fontWeight: 700,
  color: '#0F172A',
  margin: '0 0 1.25rem',
  lineHeight: 1.3,
  letterSpacing: '-0.01em',
};

export const MAIN_CONTAINER_CLASS = 'mx-auto px-5 sm:px-8 py-8 pb-20';
export const MAIN_CONTAINER_MAX = 1040;
