import { useState, useEffect }  from 'react';
import { unescapeHtml }         from '@/lib/uploadValidation';
import UploadSteps              from '@/components/upload/UploadSteps';
import AnalysisProgress         from '@/components/analyzing/AnalysisProgress';
import StepList                 from '@/components/analyzing/StepList';
import TrustRotator             from '@/components/analyzing/TrustRotator';
import AnalysisError            from '@/components/analyzing/AnalysisError';
import { useAnalysis }          from '@/hooks/useAnalysisPolling';

const SHADOW = '0 18px 44px rgba(15, 23, 42, 0.08)';

const KEYFRAMES = `
  @keyframes gasAnalysisPulse {
    0%, 100% { transform: scale(0.95); opacity: 0.6; }
    50%       { transform: scale(1.1);  opacity: 1;   }
  }
  @keyframes gasStepSpin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    [style*="gasAnalysisPulse"], [style*="gasStepSpin"] {
      animation: none !important;
    }
  }
`;

interface ContentProps {
  cvData:   string;
  jobDesc:  string;
  filename: string;
}

function AnalyzingContent({ cvData, jobDesc, filename }: ContentProps) {
  const { progress, steps, timerText, error, isFileError, isComplete, retry, cancel } = useAnalysis(cvData, jobDesc);
  const [showConfirm,       setShowConfirm]       = useState(false);
  const [showManualContinue, setShowManualContinue] = useState(false);

  useEffect(() => {
    if (!isComplete) return;
    const redirect = setTimeout(() => { window.location.replace('hasil.html'); }, 800);
    // Fallback: if redirect hasn't fired within 3.5s, show a manual button
    const fallback  = setTimeout(() => { setShowManualContinue(true); }, 3500);
    return () => { clearTimeout(redirect); clearTimeout(fallback); };
  }, [isComplete]);

  function confirmBack() {
    cancel();
    try {
      sessionStorage.removeItem('gaslamar_cv_pending');
      sessionStorage.removeItem('gaslamar_jd_pending');
      sessionStorage.removeItem('gaslamar_filename');
    } catch (_) {}
    window.location.href = 'upload.html';
  }

  return (
    <>
      <UploadSteps currentStep={3} />

      {error
        ? <AnalysisError message={error} onRetry={retry} isFileError={isFileError} />
        : (
          <>
            <AnalysisProgress progress={progress} timerText={timerText} filename={filename} />
            <StepList steps={steps} />
            <TrustRotator />

            {showManualContinue && (
              <div className="text-center mt-5">
                <a
                  href="hasil.html"
                  className="inline-flex items-center gap-2 font-bold text-white px-8 py-3 rounded-2xl transition-all hover:-translate-y-0.5 min-h-[44px]"
                  style={{
                    background:  'linear-gradient(180deg,#3b82f6,#1d4ed8)',
                    boxShadow:   '0 8px 24px rgba(37,99,235,0.35)',
                  }}
                >
                  Lihat Hasil CV →
                </a>
                <p className="text-xs text-slate-400 mt-2">Redirect otomatis tidak berjalan — klik untuk melanjutkan</p>
              </div>
            )}

            <div className="text-center mt-2">
              {showConfirm ? (
                <div className="inline-flex flex-col items-center gap-2">
                  <p className="text-[0.8rem] text-slate-600 font-medium">
                    Yakin ingin keluar? Analisis akan dibatalkan.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={confirmBack}
                      className="min-h-[44px] px-5 rounded-full text-sm font-semibold text-white border-0 cursor-pointer transition-all hover:-translate-y-[1px] active:opacity-80"
                      style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)' }}
                    >
                      Ya, keluar
                    </button>
                    <button
                      onClick={() => setShowConfirm(false)}
                      className="min-h-[44px] px-5 rounded-full text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 border-0 cursor-pointer transition-colors"
                    >
                      Tidak
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowConfirm(true)}
                  className="text-slate-400 hover:text-slate-700 text-[0.8rem] inline-flex items-center gap-1.5 transition-colors min-h-[44px] px-3 cursor-pointer bg-transparent border-none font-[inherit]"
                >
                  ← Ubah CV atau job
                </button>
              )}
            </div>
          </>
        )
      }
    </>
  );
}

export default function Analyzing() {
  const [cvData]   = useState(() => sessionStorage.getItem('gaslamar_cv_pending')  || '');
  const [jobDesc]  = useState(() => unescapeHtml(sessionStorage.getItem('gaslamar_jd_pending') || ''));
  const [filename] = useState(() => sessionStorage.getItem('gaslamar_filename')    || 'CV Kamu');

  const ready = !!(cvData && jobDesc);

  useEffect(() => {
    if (ready) return;
    const scoring     = sessionStorage.getItem('gaslamar_scoring');
    const analyzeTime = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0');
    const isFresh     = !!(scoring && analyzeTime && (Date.now() - analyzeTime) < 7_200_000);
    window.location.replace(isFresh ? 'hasil.html' : 'upload.html?reason=missing_data');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return null;

  return (
    <div
      className="min-h-dvh text-gray-900 font-sans"
      style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%,rgba(37,99,235,0.08),transparent)' }}
    >
      <style>{KEYFRAMES}</style>
      <a
        href="#analyzing-main"
        className="absolute left-[-9999px] top-0 z-[9999] bg-slate-900 text-white px-4 py-2 text-sm font-semibold rounded-br-lg focus:left-0"
      >
        Langsung ke konten analisis
      </a>

      <nav
        className="border-b py-4 px-6 flex items-center sticky top-0 z-50 backdrop-blur-[14px]"
        style={{ borderColor: 'rgba(148,163,184,0.18)', background: 'rgba(255,255,255,0.88)' }}
        aria-label="Site navigation"
      >
        <a href="index.html" className="no-underline inline-flex items-center min-h-[44px]">
          <img src="assets/logo.svg" alt="GasLamar" height="28" style={{ display: 'block' }} />
        </a>
      </nav>

      <main id="analyzing-main" className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <div
          className="rounded-[24px] px-6 py-6 sm:px-8 sm:py-9"
          style={{
            background:     'rgba(255,255,255,0.88)',
            border:         '1px solid rgba(148,163,184,0.14)',
            boxShadow:      SHADOW,
            backdropFilter: 'blur(14px)',
          }}
        >
          <AnalyzingContent cvData={cvData} jobDesc={jobDesc} filename={filename} />
        </div>

        <p className="text-center mt-6 text-xs text-slate-400">
          Data kamu tidak disimpan di server setelah analisis selesai.
        </p>
        <p className="text-center mt-3 text-xs text-slate-400">
          GasLamar · Biar CV kamu nggak tenggelam
        </p>
      </main>
    </div>
  );
}
