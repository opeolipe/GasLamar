import { useState } from 'react';
import UrlFetcher from './UrlFetcher';
import { MAX_JD_CHARS } from '@/lib/uploadValidation';
import { evaluateJDQuality } from '@/utils/evaluateJDQuality';

interface Props {
  value:    string;
  onChange: (value: string) => void;
}

export default function JobDescriptionInput({ value, onChange }: Props) {
  const [showFetcher, setShowFetcher] = useState(false);
  const count   = value.length;
  const trimmed = value.trim();
  const quality = evaluateJDQuality(value);

  const textareaCls = [
    'w-full min-h-[140px] rounded-2xl border border-dashed bg-transparent p-5',
    'text-slate-900 resize-y outline-none text-sm font-sans transition-all',
    'focus:ring-2 focus:ring-offset-2 border-slate-300 focus:border-blue-500/50 focus:ring-slate-200',
  ].join(' ');

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const raw = e.target.value;
    onChange(raw.length > MAX_JD_CHARS ? raw.slice(0, MAX_JD_CHARS) : raw);
  }

  return (
    <div>
      <label className="block text-sm font-semibold mb-2 mt-6" htmlFor="job-desc">
        Job yang kamu targetkan
      </label>

      <div className="mb-3">
        {showFetcher ? (
          <UrlFetcher
            onFetchSuccess={(text) => { onChange(text.slice(0, MAX_JD_CHARS)); setShowFetcher(false); }}
            onClose={() => setShowFetcher(false)}
          />
        ) : (
          <p className="text-sm text-slate-500">
            Paste job description atau{' '}
            <button
              type="button"
              onClick={() => setShowFetcher(true)}
              className="text-blue-600 hover:underline font-medium"
              aria-label="Ambil job description dari URL loker seperti LinkedIn, Glints, atau JobStreet"
            >
              ambil dari URL
            </button>
          </p>
        )}
      </div>

      <div>
        <textarea
          id="job-desc"
          value={value}
          onChange={handleChange}
          rows={6}
          maxLength={MAX_JD_CHARS}
          placeholder={`Contoh:\nPosisi: Digital Marketing Specialist\n\nKualifikasi:\n- Pengalaman 2+ tahun di social media marketing\n- Familiar dengan Google Analytics & Facebook Ads\n\nTanggung Jawab:\n- Kelola konten Instagram, TikTok, LinkedIn`}
          className={textareaCls}
          aria-label="Job description atau lowongan kerja yang kamu targetkan"
        />
        <div className="text-right text-xs mt-1 text-slate-400">
          {count.toLocaleString('id-ID')} / 5.000 karakter
        </div>
      </div>

      {trimmed && quality.missing.length > 0 && (
        <p className="text-xs text-slate-500 mt-2">
          Tambahkan: {quality.missing.slice(0, 3).join(' · ')}
        </p>
      )}

      {trimmed && quality.isValid && (
        <p className="text-xs text-emerald-600 mt-2">✓ Siap dianalisis</p>
      )}
    </div>
  );
}
