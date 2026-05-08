import { useState, useRef } from 'react';
import { WORKER_URL } from '@/lib/resultUtils';

export interface CouponResult {
  valid:             boolean;
  coupon_code:       string;
  discount_type:     'percentage' | 'monetary';
  discount_value:    number;
  original_amount:   number;
  discounted_amount: number;
}

interface Props {
  tier:         string | null;
  email:        string;
  onApplied:    (result: CouponResult) => void;
  onCleared:    () => void;
  applied:      CouponResult | null;
}

export default function CouponInput({ tier, email, onApplied, onCleared, applied }: Props) {
  const [code,    setCode]    = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleApply() {
    if (!tier) {
      setError('Pilih paket terlebih dahulu');
      return;
    }
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError('Masukkan kode promo');
      inputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${WORKER_URL}/validate-coupon`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          coupon_code: trimmed,
          tier,
          ...(email ? { email } : {}),
        }),
      });

      const data = await res.json() as { valid: boolean; message?: string } & Partial<CouponResult>;

      if (!data.valid) {
        setError(data.message || 'Kode promo tidak valid');
        return;
      }

      onApplied(data as CouponResult);
    } catch {
      setError('Gagal memvalidasi kode. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setCode('');
    setError(null);
    onCleared();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleApply();
  }

  // ── Already applied ───────────────────────────────────────────────────────
  if (applied) {
    const savings = applied.original_amount - applied.discounted_amount;
    const savingsStr = savings.toLocaleString('id-ID');
    const discLabel = applied.discount_type === 'percentage'
      ? `${applied.discount_value}% off`
      : `Rp ${applied.discount_value.toLocaleString('id-ID')} off`;

    return (
      <div style={{
        background:    '#F0FDF4',
        border:        '1px solid #86EFAC',
        borderRadius:  14,
        padding:       '0.75rem 1rem',
        marginBottom:  '0.75rem',
        display:       'flex',
        alignItems:    'center',
        justifyContent:'space-between',
        gap:           '0.5rem',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#15803D' }}>✓ {applied.coupon_code}</span>
            <span style={{ fontSize: '0.75rem', background: '#DCFCE7', color: '#166534', padding: '0.1rem 0.5rem', borderRadius: 60, fontWeight: 600 }}>{discLabel}</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#166534', marginTop: '0.2rem' }}>
            Hemat Rp {savingsStr} — berlaku di halaman pembayaran
          </div>
        </div>
        <button
          onClick={handleClear}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#86EFAC', fontSize: '1.1rem', lineHeight: 1, padding: '0.25rem', fontFamily: 'inherit' }}
          aria-label="Hapus kode promo"
        >
          ✕
        </button>
      </div>
    );
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'stretch' }}>
        <input
          ref={inputRef}
          type="text"
          value={code}
          onChange={e => { setCode(e.target.value.toUpperCase()); setError(null); }}
          onKeyDown={handleKeyDown}
          placeholder="Punya kode promo?"
          maxLength={64}
          disabled={loading}
          style={{
            flex:         1,
            padding:      '0.6rem 0.9rem',
            border:       error ? '1.5px solid #F87171' : '1px solid rgba(148,163,184,0.35)',
            borderRadius: 10,
            fontSize:     '0.9rem',
            fontFamily:   'inherit',
            outline:      'none',
            background:   'white',
            color:        '#111827',
            letterSpacing:'0.04em',
          }}
          aria-label="Kode promo"
        />
        <button
          onClick={handleApply}
          disabled={loading || !code.trim()}
          style={{
            padding:      '0.6rem 1.1rem',
            background:   loading || !code.trim() ? '#E2E8F0' : '#1E40AF',
            color:        loading || !code.trim() ? '#94A3B8' : 'white',
            border:       'none',
            borderRadius: 10,
            fontWeight:   700,
            fontSize:     '0.875rem',
            cursor:       loading || !code.trim() ? 'not-allowed' : 'pointer',
            fontFamily:   'inherit',
            whiteSpace:   'nowrap',
            transition:   '0.15s',
          }}
        >
          {loading ? '...' : 'Pakai'}
        </button>
      </div>
      {error && (
        <p style={{ fontSize: '0.8rem', color: '#DC2626', margin: '0.3rem 0 0', paddingLeft: '0.1rem' }}>
          {error}
        </p>
      )}
    </div>
  );
}
