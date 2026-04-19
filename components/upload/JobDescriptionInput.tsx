import { useState } from 'react';
import UrlFetcher from './UrlFetcher';
import { MAX_JD_CHARS, MIN_JD_LENGTH } from '@/lib/uploadValidation';

interface Props {
  value:    string;
  onChange: (value: string) => void;
  error:    string;
  touched:  boolean;
}

export default function JobDescriptionInput({ value, onChange, error, touched }: Props) {
  const [showFetcher, setShowFetcher] = useState(false);

  const count     = value.length;
  const meetsMin  = value.trim().length >= MIN_JD_LENGTH;
  const nearLimit = count > 4500 && count < MAX_JD_CHARS;
  const atLimit   = count >= MAX_JD_CHARS;

  const counterCls = atLimit
    ? 'text-red-600 font-semibold'
    : nearLimit
    ? 'text-amber-600'
    : 'text-slate-400';

  const textareaCls = [
    'w-full min-h-[140px] rounded-2xl border border-dashed bg-transparent p-5',
    'text-slate-900 resize-y outline-none text-sm font-sans transition-all',
    'focus:ring-2 focus:ring-offset-2',
    meetsMin
      ? 'border-emerald-400/60 focus:border-emerald-500/60 focus:ring-emerald-100'
      : 'border-slate-300 focus:border-blue-500/50 focus:ring-slate-200',
  ].join(' ');

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const raw = e.target.value;
    onChange(raw.length > MAX_JD_CHARS ? raw.slice(0, MAX_JD_CHARS) : raw);
  }

  return (
    <div>
      <label className="flex items-center gap-1 text-sm font-semibold mb-2 mt-6" htmlFor="job-desc">
        Job yang kamu targetkan
        <span className="relative inline-flex items-center cursor-help group" tabIndex={0}>
          <span className="text-[0.65rem] font-bold text-slate-400 bg-slate-100 rounded-full w-[15px] h-[15px] inline-flex items-center justify-center leading-none">?</span>
          <span className="invisible group-hover:visible group-focus:visible opacity-0 group-hover:opacity-100 group-focus:opacity-100 absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 w-[220px] text-center z-20 transition-opacity leading-snug pointer-events-none">
            Paste bagian "Requirements" atau "Qualifications" dari lowongan. Ini membuat analisis 3× lebih akurat dan relevan.
          </span>
        </span>
      </label>

      {/* Helper card */}
      <div className="bg-blue-50/60 border border-blue-200 rounded-2xl p-4 mb-4">
        {showFetcher ? (
          <UrlFetcher
            onFetchSuccess={(text) => { onChange(text.slice(0, MAX_JD_CHARS)); setShowFetcher(false); }}
            onClose={() => setShowFetcher(false)}
          />
        ) : (
          <>
            <p className="font-semibold text-blue-800 text-sm mb-0.5">💡 Belum punya Job Description?</p>
            <p className="text-xs text-blue-700 mb-3">Pilih salah satu cara di bawah — atau paste manual langsung ke kotak teks</p>
            <button
              type="button"
              onClick={() => setShowFetcher(true)}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-blue-200 text-blue-700 text-xs font-semibold hover:bg-blue-50 transition-colors"
              aria-label="Ambil job description dari URL loker seperti LinkedIn, Glints, atau JobStreet"
            >
              🔗 Ambil dari URL Loker
            </button>
          </>
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
        <div className={`text-right text-xs mt-1 ${counterCls}`}>
          {count.toLocaleString('id-ID')} / 5.000 karakter
        </div>
      </div>

      {atLimit   && <p className="text-xs text-red-600 mt-0.5">Batas karakter tercapai</p>}
      {!atLimit && nearLimit && <p className="text-xs text-amber-600 mt-0.5">Mendekati batas karakter</p>}

      {touched && error && (
        <div className="mt-2 rounded-[12px] px-4 py-2.5 text-sm text-red-700 bg-red-50 border border-red-200">
          {error}
        </div>
      )}
      {meetsMin && (
        <p className="text-xs text-emerald-600 mt-1.5" role="status" aria-live="polite">
          ✓ Minimal 100 karakter terpenuhi
        </p>
      )}
    </div>
  );
}
