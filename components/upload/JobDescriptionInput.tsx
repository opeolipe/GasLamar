import { useState, forwardRef, useRef, useEffect } from 'react';
import UrlFetcher from './UrlFetcher';
import { MAX_JD_CHARS } from '@/lib/uploadValidation';
import { evaluateJDQuality } from '@/utils/evaluateJDQuality';

interface Props {
  value:        string;
  onChange:     (value: string) => void;
  submitError?: string;
  onSubmit?:    () => void;
}

const JD_EXAMPLE = `Posisi: Digital Marketing Specialist
Kualifikasi:
- Social media marketing 2+ tahun
- Google Analytics & Facebook Ads`;

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

  // Native listener catches programmatic `el.value = x; el.dispatchEvent(new Event('input'))`
  // React's controlled-input tracker intercepts el.value assignments and marks the new value
  // as "already seen", so React's synthetic onChange won't fire. The native listener below
  // reads the DOM value directly and calls onChange regardless of React's tracker state.
  useEffect(() => {
    const el = internalRef.current;
    if (!el) return;
    function onNativeInput() {
      const raw = el!.value;
      const capped = raw.length > MAX_JD_CHARS ? raw.slice(0, MAX_JD_CHARS) : raw;
      onChangeRef.current(capped);
      el!.style.height = 'auto';
      el!.style.height = `${el!.scrollHeight}px`;
    }
    el.addEventListener('input', onNativeInput);
    return () => el.removeEventListener('input', onNativeInput);
  }, []);

  // Resize height when value changes via React state (URL fetcher, session restore)
  useEffect(() => {
    const el = internalRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const textareaCls = [
    'block w-full max-w-full min-h-[140px] rounded-2xl border bg-transparent p-4',
    'text-slate-900 resize-y outline-none text-sm font-sans transition-all',
    'focus:ring-2 focus:ring-offset-1 border-slate-200 focus:border-blue-400 focus:ring-blue-100',
  ].join(' ');

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const raw = e.target.value;
    onChange(raw.length > MAX_JD_CHARS ? raw.slice(0, MAX_JD_CHARS) : raw);
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
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
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              onSubmit?.();
            }
          }}
        />
        <div className="flex items-center justify-between mt-1">
          <button
            type="button"
            onClick={() => setShowExample(s => !s)}
            className="text-xs text-slate-400 hover:text-slate-600 underline decoration-dotted transition-colors"
          >
            {showExample ? 'Sembunyikan contoh' : 'Lihat contoh job description'}
          </button>
          <span className={counterCls}>
            {charCount.toLocaleString('id-ID')} / {MAX_JD_CHARS.toLocaleString('id-ID')} karakter
            {atLimit && ' — Maks 5.000 karakter (sisanya dipotong)'}
          </span>
        </div>
        {showExample && (
          <div className="mt-2 p-3 bg-slate-50 rounded-xl text-xs text-slate-500 leading-relaxed border border-slate-100 font-mono max-w-full overflow-hidden" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
            {JD_EXAMPLE}
          </div>
        )}
      </div>

      {submitError ? (
        <div role="alert" className="mt-2 rounded-[10px] px-3 py-2.5 text-sm font-medium bg-red-50 border border-red-200 text-red-700">
          <span aria-hidden="true">⚠️</span> {submitError}
        </div>
      ) : trimmed && quality.message ? (
        <p className="text-sm text-slate-500 mt-2 break-words" style={{ overflowWrap: 'anywhere' }}>{quality.message}</p>
      ) : trimmed && !quality.message ? (
        <p className="text-sm text-emerald-600 mt-2 font-medium"><span aria-hidden="true">✓</span> Job description siap</p>
      ) : (
        <p className="text-sm text-slate-500 mt-2">
          Job description wajib diisi. Minimal berisi kualifikasi dan tanggung jawab utama.
        </p>
      )}
    </div>
  );
});

export default JobDescriptionInput;
