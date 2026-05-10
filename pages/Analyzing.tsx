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
`;

interface ContentProps {
  cvData:   string;
  jobDesc:  string;
  filename: string;
}

function AnalyzingContent({ cvData, jobDesc, filename }: ContentProps) {
  const { progress, steps, timerText, error, isFileError, isComplete, retry, cancel } = useAnalysis(cvData, jobDesc);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!isComplete) return;
    const t = setTimeout(() => { window.location.replace('hasil.html'); }, 800);
    return () => clearTimeout(t);
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
            <div className="text-center mt-2">
              {showConfirm ? (
                <div className="inline-flex flex-col items-center gap-2">
                  <p className="text-[0.8rem] text-slate-600 font-medium">
                    Yakin ingin keluar? Analisis akan dibatalkan.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={confirmBack}
                      className="min-h-[36px] px-4 rounded-full text-[0.8rem] font-semibold text-white border-0 cursor-pointer transition-all hover:-translate-y-[1px]"
                      style={{ background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)' }}
                    >
                      Ya, keluar
                    </button>
                    <button
                      onClick={() => setShowConfirm(false)}
                      className="min-h-[36px] px-4 rounded-full text-[0.8rem] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 border-0 cursor-pointer transition-colors"
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
      className="min-h-screen text-gray-900 font-sans"
      style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%,rgba(37,99,235,0.08),transparent)' }}
    >
      <style>{KEYFRAMES}</style>

      <nav
        className="border-b py-4 px-6 flex items-center sticky top-0 z-50 backdrop-blur-[14px]"
        style={{ borderColor: 'rgba(148,163,184,0.18)', background: 'rgba(255,255,255,0.88)' }}
      >
        <img src="assets/logo.svg" alt="GasLamar" height="28" style={{ display: 'block' }} />
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
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

        <p className="text-center mt-6 text-[0.72rem] text-slate-400">
          Data kamu tidak disimpan di server setelah analisis selesai.
        </p>
      </main>
    </div>
  );
}
