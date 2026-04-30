import { useState, forwardRef, useRef, useEffect } from 'react';
import UrlFetcher from './UrlFetcher';
import { MAX_JD_CHARS } from '@/lib/uploadValidation';
import { evaluateJDQuality } from '@/utils/evaluateJDQuality';

interface Props {
  value:    string;
  onChange: (value: string) => void;
}

const JobDescriptionInput = forwardRef<HTMLTextAreaElement, Props>(function JobDescriptionInput({ value, onChange }, ref) {
  const [showFetcher, setShowFetcher] = useState(false);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  // Keep a ref to onChange so the native listener never goes stale without re-mounting.
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

  const textareaCls = [
    'w-full max-w-full min-h-[160px] rounded-2xl border bg-transparent p-5',
    'text-slate-900 resize-y outline-none text-sm font-sans transition-all',
    'focus:ring-2 focus:ring-offset-2 border-slate-300 focus:border-blue-500/50 focus:ring-slate-200',
  ].join(' ');

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const raw = e.target.value;
    onChange(raw.length > MAX_JD_CHARS ? raw.slice(0, MAX_JD_CHARS) : raw);
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  }

  return (
    <div>
      <label className="block text-sm font-semibold mb-2 mt-6" htmlFor="job-desc">
        Job yang kamu targetkan
      </label>

      <div className="mb-3">
        {showFetcher ? (
          <UrlFetcher
            onFetchSuccess={(text) => { onChange((text ?? '').slice(0, MAX_JD_CHARS)); setShowFetcher(false); }}
            onClose={() => setShowFetcher(false)}
          />
        ) : (
          <p className="text-sm text-slate-500">
            Paste job description{' '}
            <span className="text-slate-400">(requirements / tanggung jawab)</span>
            {' '}atau{' '}
            <button
              type="button"
              onClick={() => setShowFetcher(true)}
              className="text-blue-600 underline hover:no-underline font-medium inline-flex items-center min-h-[44px] px-0.5"
              aria-label="Ambil job description dari URL loker seperti LinkedIn, Glints, atau JobStreet"
            >
              ambil dari URL
            </button>
          </p>
        )}
      </div>

      <div>
        <textarea
          ref={(el) => {
            internalRef.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
          }}
          id="job-desc"
          data-testid="jd-textarea"
          value={value}
          onChange={handleChange}
          maxLength={MAX_JD_CHARS}
          placeholder={`Contoh:\nPosisi: Digital Marketing Specialist\n\nKualifikasi:\n- Pengalaman 2+ tahun di social media marketing\n- Familiar dengan Google Analytics & Facebook Ads\n\nTanggung Jawab:\n- Kelola konten Instagram, TikTok, LinkedIn`}
          className={textareaCls}
          aria-label="Job description atau lowongan kerja yang kamu targetkan"
        />
        <div className="text-right text-sm mt-1 text-slate-400">
          {value.length.toLocaleString('id-ID')} / 5.000 karakter
        </div>
      </div>

      {trimmed && quality.message && (
        <p className="text-sm text-slate-500 mt-2">{quality.message}</p>
      )}

      {trimmed && !quality.message && (
        <p className="text-sm text-emerald-600 mt-2">✓ Siap dianalisis</p>
      )}
    </div>
  );
});

export default JobDescriptionInput;
