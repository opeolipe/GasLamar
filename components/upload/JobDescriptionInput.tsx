import { useState, forwardRef, useRef, useEffect } from 'react';
import UrlFetcher from './UrlFetcher';
import { MAX_JD_CHARS, MIN_JD_LENGTH } from '@/lib/uploadValidation';
import { evaluateJDQuality } from '@/utils/evaluateJDQuality';

interface Props {
  value:        string;
  onChange:     (value: string) => void;
  submitError?: string;
  onSubmit?:    () => void;
}

const JD_EXAMPLE = `Posisi: Digital Marketing Specialist

Tanggung Jawab:
- Mengelola konten dan kampanye di Instagram, TikTok, dan LinkedIn
- Menganalisis performa iklan melalui Google Analytics & Meta Ads Manager
- Membuat laporan mingguan performa kampanye dan rekomendasi optimasi
- Berkoordinasi dengan tim desain untuk materi konten

Kualifikasi:
- Pengalaman minimal 2 tahun di bidang digital marketing
- Mahir mengoperasikan Google Analytics, Facebook Ads, dan Google Ads
- Familiar dengan tools SEO (SEMrush / Ahrefs) menjadi nilai plus
- Kemampuan copywriting yang baik dalam Bahasa Indonesia dan Inggris
- Berorientasi pada data dan target

Info tambahan:
- Lokasi: Jakarta Selatan (hybrid, 3x seminggu WFO)
- Gaji: Rp 8–12 juta/bulan (sesuai pengalaman)`;

const MIN_JD_CHARS = MIN_JD_LENGTH;

const JobDescriptionInput = forwardRef<HTMLTextAreaElement, Props>(function JobDescriptionInput({ value, onChange, submitError, onSubmit }, ref) {
  const [showFetcher, setShowFetcher] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const trimmed = value.trim();
  const quality = evaluateJDQuality(value);

  const charCount = value.length;
  const atLimit   = charCount >= MAX_JD_CHARS;
  const nearLimit = charCount >= 4500 && !atLimit;
  const counterCls = atLimit
    ? 'text-xs text-red-600 font-medium'
    : nearLimit
    ? 'text-xs text-amber-500'
    : 'text-xs text-slate-400';

  function syncTextareaValue(raw: string, el?: HTMLTextAreaElement | null) {
    const capped = raw.length > MAX_JD_CHARS ? raw.slice(0, MAX_JD_CHARS) : raw;
    if (el && el.value !== capped) el.value = capped;
    onChangeRef.current(capped);
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }

  // Native listener catches programmatic `el.value = x; el.dispatchEvent(new Event('input'))`.
  useEffect(() => {
    const el = internalRef.current;
    if (!el) return;
    function onNativeInput() {
      syncTextareaValue(el!.value, el);
    }
    el.addEventListener('input', onNativeInput);
    return () => el.removeEventListener('input', onNativeInput);
  }, []);

  // Direct `textarea.value = x` does not fire an input event, so bridge that path too.
  // Guard flag prevents re-entrant calls (React reconciler sets el.value on every render
  // for controlled components, which would otherwise trigger onChange unnecessarily).
  useEffect(() => {
    const el = internalRef.current;
    if (!el) return;

    const ownDescriptor = Object.getOwnPropertyDescriptor(el, 'value');
    const protoDescriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    const descriptor = ownDescriptor ?? protoDescriptor;
    if (!descriptor?.get || !descriptor?.set) return;

    let setting = false;

    Object.defineProperty(el, 'value', {
      configurable: true,
      get() {
        return descriptor.get!.call(this);
      },
      set(next) {
        if (setting) { descriptor.set!.call(this, next); return; }
        setting = true;
        try {
          const raw = String(next ?? '');
          const capped = raw.length > MAX_JD_CHARS ? raw.slice(0, MAX_JD_CHARS) : raw;
          const prev = descriptor.get!.call(this);
          descriptor.set!.call(this, capped);
          // Only propagate to React state when the value actually changed (not React reconciling).
          if (capped !== prev) syncTextareaValue(capped, this as HTMLTextAreaElement);
        } finally {
          setting = false;
        }
      },
    });

    return () => {
      if (ownDescriptor) Object.defineProperty(el, 'value', ownDescriptor);
      else Reflect.deleteProperty(el, 'value');
    };
  }, []);

  // Resize height when value changes via React state (URL fetcher, session restore)
  useEffect(() => {
    const el = internalRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Dynamic border based on validation state
  const borderCls = submitError
    ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
    : trimmed && quality.isValid
    ? 'border-emerald-300 focus:border-emerald-400 focus:ring-emerald-100'
    : trimmed && !quality.isValid
    ? 'border-amber-200 focus:border-amber-300 focus:ring-amber-100'
    : 'border-slate-200 focus:border-blue-400 focus:ring-blue-100';

  const textareaCls = [
    'block w-full max-w-full min-h-[140px] rounded-2xl border bg-transparent p-4',
    'text-slate-900 resize-y outline-none text-sm font-sans transition-all',
    'focus:ring-2 focus:ring-offset-1',
    borderCls,
  ].join(' ');

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    syncTextareaValue(e.target.value, e.target);
  }

  return (
    <div className="w-full">
      <label className="block text-sm font-semibold mb-2 mt-6" htmlFor="job-desc">
        Job yang kamu targetkan (wajib)
      </label>

      <div className="mb-3">
        {showFetcher ? (
          <UrlFetcher
            onFetchSuccess={(text) => { onChange((text ?? '').slice(0, MAX_JD_CHARS)); setShowFetcher(false); }}
            onClose={() => setShowFetcher(false)}
          />
        ) : (
          <p className="text-sm text-slate-500 flex items-center flex-wrap gap-1.5">
            Paste job description atau
            <button
              type="button"
              onClick={() => setShowFetcher(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 text-blue-600 font-medium text-sm transition-colors min-h-[36px] leading-none"
              aria-label="Ambil job description dari URL loker seperti LinkedIn, Glints, atau JobStreet"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
              Ambil via link
            </button>
          </p>
        )}
      </div>

      <div className="w-full">
        <textarea
          ref={(el) => {
            internalRef.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
          }}
          id="job-desc"
          data-testid="jd-textarea"
          inputMode="text"
          value={value}
          onChange={handleChange}
          maxLength={MAX_JD_CHARS}
          placeholder="Paste isi loker di sini..."
          className={textareaCls}
          aria-label="Job description atau lowongan kerja yang kamu targetkan"
          aria-describedby="jd-feedback"
          aria-invalid={!!submitError || (!!trimmed && !quality.isValid) ? 'true' : undefined}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              onSubmit?.();
            }
          }}
        />
        <div className="flex items-center justify-between mt-1 gap-2">
          <button
            type="button"
            onClick={() => setShowExample(s => !s)}
            className="text-xs text-slate-400 hover:text-slate-600 underline decoration-dotted transition-colors"
          >
            {showExample ? 'Sembunyikan contoh' : 'Lihat contoh job description'}
          </button>
          <span className={`${trimmed ? counterCls : 'text-xs text-slate-400'} flex-shrink-0`}>
            {trimmed
              ? `${charCount.toLocaleString('id-ID')} / ${MAX_JD_CHARS.toLocaleString('id-ID')} karakter${atLimit ? ' — Maks 5.000 karakter (sisanya dipotong)' : ''}`
              : `min. ${MIN_JD_CHARS} karakter`}
          </span>
        </div>
        {showExample && (
          <div
            className="mt-2 rounded-xl border border-slate-200 bg-slate-50 max-w-full overflow-hidden"
            role="region"
            aria-label="Contoh job description"
          >
            <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 border-b border-slate-100">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Contoh format JD</span>
              <span className="text-[11px] text-slate-400">Tidak mengubah isian kamu</span>
            </div>
            <pre
              className="p-3 text-xs text-slate-600 leading-relaxed font-mono max-w-full overflow-x-auto"
              style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', margin: 0 }}
            >
              {JD_EXAMPLE}
            </pre>
            <div className="px-3 pb-3">
              <button
                type="button"
                onClick={() => { onChange(JD_EXAMPLE); setShowExample(false); }}
                className="text-xs text-blue-600 hover:text-blue-800 underline decoration-dotted transition-colors font-sans"
              >
                Gunakan contoh ini sebagai isian
              </button>
            </div>
          </div>
        )}
      </div>

      <div id="jd-feedback" aria-live="polite">
        {submitError ? (
          <div
            key={submitError}
            role="alert"
            className="mt-2 rounded-[10px] px-3 py-2.5 text-sm font-medium bg-red-50 border border-red-200 text-red-700"
            style={{ animation: 'gasShake 0.4s ease-out' }}
          >
            <span aria-hidden="true">⚠️</span> {submitError}
          </div>
        ) : trimmed && quality.message ? (
          <p className="text-sm text-amber-700 mt-2 break-words" style={{ overflowWrap: 'anywhere' }}>
            <span aria-hidden="true">⚠️</span> {quality.message}
          </p>
        ) : trimmed && !quality.message ? (
          <p className="text-sm text-emerald-600 mt-2 font-medium"><span aria-hidden="true">✓</span> Job description siap</p>
        ) : (
          <p className="text-sm text-slate-500 mt-2">
            Minimal berisi kualifikasi dan tanggung jawab posisi yang kamu lamar.
          </p>
        )}
      </div>
    </div>
  );
});

export default JobDescriptionInput;
