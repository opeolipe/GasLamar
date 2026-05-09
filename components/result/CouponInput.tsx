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
  tier:      string | null;
  email:     string;
  onApplied: (result: CouponResult) => void;
  onCleared: () => void;
  applied:   CouponResult | null;
}

export default function CouponInput({ tier, email, onApplied, onCleared, applied }: Props) {
  const [open,    setOpen]    = useState(false);
  const [code,    setCode]    = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleApply() {
    if (!tier) { setError('Pilih paket terlebih dahulu'); return; }
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setError('Masukkan kode promo'); inputRef.current?.focus(); return; }
    if (trimmed.length < 3) { setError('Kode promo minimal 3 karakter'); return; }
    if (!/^[A-Z0-9_\-]+$/.test(trimmed)) { setError('Kode promo hanya boleh berisi huruf, angka, - atau _'); return; }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${WORKER_URL}/validate-coupon`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ coupon_code: trimmed, tier, ...(email ? { email } : {}) }),
      });
      const data = await res.json() as { valid: boolean; message?: string } & Partial<CouponResult>;
      if (!data.valid) { setError(data.message || 'Kode promo tidak valid'); return; }
      onApplied(data as CouponResult);
      setOpen(false);
    } catch {
      setError('Gagal memvalidasi kode. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setCode('');
    setError(null);
    setOpen(false);
    onCleared();
  }

  // ── Already applied ───────────────────────────────────────────────────────
  if (applied) {
    const savings    = applied.original_amount - applied.discounted_amount;
    const savingsStr = savings.toLocaleString('id-ID');
    const discLabel  = applied.discount_type === 'percentage'
      ? `${applied.discount_value}% off`
      : `Rp ${applied.discount_value.toLocaleString('id-ID')} off`;

    return (
      <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 12, padding: '0.65rem 1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#15803D' }}>✓ {applied.coupon_code}</span>
            <span style={{ fontSize: '0.7rem', background: '#DCFCE7', color: '#166534', padding: '0.1rem 0.5rem', borderRadius: 60, fontWeight: 600 }}>{discLabel}</span>
          </div>
          <div data-testid="discount-badge" style={{ fontSize: '0.75rem', color: '#166534', marginTop: '0.15rem' }}>
            Hemat Rp {savingsStr} — berlaku di halaman pembayaran
          </div>
        </div>
        <button onClick={handleClear} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#86EFAC', fontSize: '1rem', lineHeight: 1, padding: '0.25rem', fontFamily: 'inherit' }} aria-label="Hapus kode promo">
          ✕
        </button>
      </div>
    );
  }

  // ── Collapsed disclosure ──────────────────────────────────────────────────
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      {!open ? (
        <button
          onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
          style={{ background: 'none', border: 'none', padding: 0, color: '#64748B', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
        >
          Punya kode promo?
        </button>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'stretch' }}>
            <input
              ref={inputRef}
              type="text"
              value={code}
              onChange={e => { setCode(e.target.value.replace(/[^A-Za-z0-9_\-]/g, '').toUpperCase()); setError(null); }}
              onKeyDown={e => e.key === 'Enter' && handleApply()}
              placeholder="Kode promo"
              maxLength={64}
              disabled={loading}
              style={{ flex: 1, padding: '0.6rem 0.9rem', border: error ? '1.5px solid #F87171' : '1px solid #CBD5E1', borderRadius: 10, fontSize: '0.875rem', fontFamily: 'inherit', outline: 'none', background: 'white', color: '#111827', letterSpacing: '0.04em' }}
              aria-label="Kode promo"
            />
            <button
              onClick={handleApply}
              disabled={loading || !code.trim()}
              style={{ padding: '0.6rem 1rem', background: loading || !code.trim() ? '#E2E8F0' : '#1E40AF', color: loading || !code.trim() ? '#94A3B8' : 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: '0.875rem', cursor: loading || !code.trim() ? 'not-allowed' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', transition: '0.15s' }}
            >
              {loading ? '...' : 'Pakai'}
            </button>
            <button
              onClick={() => { setOpen(false); setCode(''); setError(null); }}
              style={{ padding: '0.6rem 0.75rem', background: 'none', border: '1px solid #E2E8F0', borderRadius: 10, color: '#94A3B8', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.875rem' }}
              aria-label="Tutup"
            >
              ✕
            </button>
          </div>
          {error && (
            <p style={{ fontSize: '0.78rem', color: '#DC2626', margin: '0.3rem 0 0' }}>{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
