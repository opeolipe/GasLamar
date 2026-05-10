import { useState, forwardRef, useRef, useEffect } from 'react';
import UrlFetcher from './UrlFetcher';
import { MAX_JD_CHARS } from '@/lib/uploadValidation';
import { evaluateJDQuality } from '@/utils/evaluateJDQuality';

interface Props {
  value:    string;
  onChange: (value: string) => void;
}

const JD_EXAMPLE = `Posisi: Digital Marketing Specialist
Kualifikasi:
- Social media marketing 2+ tahun
- Google Analytics & Facebook Ads`;

const JobDescriptionInput = forwardRef<HTMLTextAreaElement, Props>(function JobDescriptionInput({ value, onChange }, ref) {
  const [showFetcher, setShowFetcher] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const trimmed = value.trim();
  const quality = evaluateJDQuality(value);

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
    <div className="w-full max-w-full overflow-hidden">
      <label className="block text-sm font-semibold mb-2 mt-4" htmlFor="job-desc">
        Posisi yang kamu incar
      </label>

      <div className="mb-3">
        {showFetcher ? (
          <UrlFetcher
            onFetchSuccess={(text) => { onChange((text ?? '').slice(0, MAX_JD_CHARS)); setShowFetcher(false); }}
            onClose={() => setShowFetcher(false)}
          />
        ) : (
          <p className="text-sm text-slate-500">
            Paste job description atau{' '}
            <button
              type="button"
              onClick={() => setShowFetcher(true)}
              className="text-blue-600 underline hover:no-underline font-medium inline-flex items-center min-h-[44px] px-0.5"
              aria-label="Ambil job description dari URL loker seperti LinkedIn, Glints, atau JobStreet"
            >
              tempel link loker →
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
        />
        <div className="flex items-center justify-between mt-1">
          <button
            type="button"
            onClick={() => setShowExample(s => !s)}
            className="text-xs text-slate-400 hover:text-slate-600 underline decoration-dotted transition-colors"
          >
            {showExample ? 'Sembunyikan contoh' : 'Lihat contoh job description'}
          </button>
          <span className="text-xs text-slate-400">
            {value.length.toLocaleString('id-ID')} / 5.000 karakter
          </span>
        </div>
        {showExample && (
          <div className="mt-2 p-3 bg-slate-50 rounded-xl text-xs text-slate-500 leading-relaxed border border-slate-100 font-mono max-w-full overflow-hidden" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
            {JD_EXAMPLE}
          </div>
        )}
      </div>

      {trimmed && quality.message && (
        <p className="text-xs text-slate-500 mt-2 break-words" style={{ overflowWrap: 'anywhere' }}>{quality.message}</p>
      )}

      {trimmed && !quality.message && (
        <p className="text-xs text-emerald-600 mt-2 font-medium">✓ Job description siap</p>
      )}
    </div>
  );
});

export default JobDescriptionInput;
