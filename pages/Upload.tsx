import { useState, useEffect, useRef } from 'react';
import TierIndicator       from '@/components/upload/TierIndicator';
import CvDropzone          from '@/components/upload/CvDropzone';
import JobDescriptionInput from '@/components/upload/JobDescriptionInput';
import SubmitSection       from '@/components/upload/SubmitSection';
import {
  VALID_TIERS,
  MIN_CV_TEXT_LENGTH,
  validateFile,
  formatFileSize,
  readFileAsEncodedBlob,
  escapeHtml,
  unescapeHtml,
} from '@/lib/uploadValidation';
import { evaluateJDQuality }          from '@/utils/evaluateJDQuality';
import { WORKER_URL, clearClientSessionData } from '@/lib/downloadUtils';

const SHADOW = '0 18px 44px rgba(15, 23, 42, 0.08)';

type NoticeType = 'info' | 'warning' | 'error';
interface Notice {
  type: NoticeType;
  text: string;
  link?: { href: string; label: string };
}

const STALE_KEYS = [
  'gaslamar_scoring', 'gaslamar_cv_key', 'gaslamar_cv_pending', 'gaslamar_jd_pending',
  'gaslamar_filename', 'gaslamar_tier', 'gaslamar_email', 'gaslamar_analyze_time',
  'gaslamar_cv_draft', 'gaslamar_filename_draft',
  'gaslamar_6d_scores', 'gaslamar_sample_line', 'gaslamar_sample_context',
  'gaslamar_sample_fallback', 'gaslamar_entitas_klaim', 'gaslamar_result_id',
];

export default function Upload() {
  // CV state
  const [fileName,    setFileName]    = useState<string | null>(null);
  const [fileSize,    setFileSize]    = useState<string | null>(null);
  const [cvText,      setCvText]      = useState('');
  const [manualCvText, setManualCvText] = useState('');
  const [fileError,   setFileError]   = useState('');
  const [scanWarning, setScanWarning] = useState(false);

  // JD state
  const [jd, setJd] = useState('');

  // UI
  const [loading,  setLoading]  = useState(false);
  const [tier,     setTier]     = useState<string | null>(null);
  const [notices,  setNotices]  = useState<Notice[]>([]);

  // JD textarea ref — used for auto-scroll after CV upload
  const jdRef = useRef<HTMLTextAreaElement | null>(null);

  const hasFile: boolean = !!fileName && !!cvText;
  const hasJD:   boolean = evaluateJDQuality(jd).isValid;
  const isValid: boolean = hasFile && hasJD;

  // Mount: read URL params + restore drafts
  useEffect(() => {
    const params     = new URLSearchParams(window.location.search);
    const tierParam  = (params.get('tier') || '').toLowerCase().trim();
    const newNotices: Notice[] = [];

    if (tierParam && !(VALID_TIERS as readonly string[]).includes(tierParam)) {
      newNotices.push({ type: 'warning', text: 'Paket tidak dikenal. Menggunakan paket Single sebagai default.' });
      params.delete('tier');
      history.replaceState(null, '', params.toString() ? `${location.pathname}?${params}` : location.pathname);
    } else if ((VALID_TIERS as readonly string[]).includes(tierParam)) {
      setTier(tierParam);
      try { sessionStorage.setItem('gaslamar_tier', tierParam); } catch (_) {}
      // Remove tier from URL after reading — the value is saved in sessionStorage.
      // Keeping it in the address bar allows manipulation that misleads users about
      // which tier they selected (even though backend enforces the real tier at checkout).
      params.delete('tier');
      history.replaceState(null, '', params.toString() ? `${location.pathname}?${params}` : location.pathname);
    }

    // Paid session takes priority — redirect the user straight to download.html
    // instead of showing stale analysis notices that point to hasil.html.
    const paidSessionId = sessionStorage.getItem('gaslamar_session') ?? localStorage.getItem('gaslamar_session') ?? '';
    const hasPaidSession = paidSessionId.startsWith('sess_');

    if (hasPaidSession) {
      const reason = params.get('reason');
      if (reason) history.replaceState(null, '', location.pathname);
      newNotices.push({
        type: 'info',
        text: 'Kamu sudah upload CV dan menyelesaikan pembayaran.',
        link: { href: 'download.html', label: 'Lanjutkan ke download →' },
      });
    } else {
      const reason = params.get('reason');
      if (reason === 'no_session') {
        history.replaceState(null, '', location.pathname);
        newNotices.push({ type: 'info', text: 'Sesi tidak ditemukan atau sudah kedaluwarsa (hasil analisis gratis aktif selama 2 jam). Silakan upload CV kembali untuk memulai analisis baru.' });
      } else if (reason === 'missing_data') {
        history.replaceState(null, '', location.pathname);
        newNotices.push({ type: 'warning', text: 'Data sesi tidak lengkap. Silakan upload CV kamu untuk memulai.' });
      } else if (reason === 'interrupted') {
        history.replaceState(null, '', location.pathname);
        newNotices.push({ type: 'warning', text: '⚠️ Analisis terputus — silakan upload ulang CV kamu untuk memulai.' });
      } else if (reason === 'session_expired') {
        history.replaceState(null, '', location.pathname);
        newNotices.push({ type: 'info', text: '⏰ Sesi analisis sudah berakhir. Silakan upload CV kembali untuk analisis baru.' });
      }

      const uploadErr = sessionStorage.getItem('gaslamar_upload_error');
      if (uploadErr) {
        sessionStorage.removeItem('gaslamar_upload_error');
        newNotices.push({ type: 'error', text: '⚠️ Analisis gagal: ' + uploadErr });
      }

      const analyzeTime = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0');
      if (analyzeTime && sessionStorage.getItem('gaslamar_scoring')) {
        const remaining = 7200 - Math.floor((Date.now() - analyzeTime) / 1000);
        if (remaining > 0) {
          const h = Math.floor(remaining / 3600);
          const m = Math.floor((remaining % 3600) / 60);
          newNotices.push({
            type: 'info',
            text: `⏰ Kamu masih punya hasil analisis aktif (${h > 0 ? `${h}j ${m}m` : `${m} menit`} tersisa).`,
            link: { href: 'hasil.html', label: 'Lihat hasil →' },
          });
        }
      }
    }

    if (newNotices.length) setNotices(newNotices);

    // Restore JD draft
    const savedJd = sessionStorage.getItem('gaslamar_jd_draft');
    if (savedJd) setJd(unescapeHtml(savedJd).slice(0, 5000));

    // Restore CV state
    const pendingCv   = sessionStorage.getItem('gaslamar_cv_pending');
    const pendingName = sessionStorage.getItem('gaslamar_filename');
    const draftCv     = sessionStorage.getItem('gaslamar_cv_draft');
    const draftName   = sessionStorage.getItem('gaslamar_filename_draft');
    const restoreCv   = pendingCv || draftCv;
    const restoreName = (pendingCv ? pendingName : draftName) || null;

    if (restoreCv && restoreName) {
      setCvText(restoreCv);
      setFileName(restoreName);
      setFileSize(pendingCv ? '(sudah diproses)' : '(draft dipulihkan)');
      try {
        const parsed = JSON.parse(restoreCv);
        if (parsed?.type === 'txt' && typeof parsed.data === 'string') setManualCvText(parsed.data);
      } catch (_) {}
    }
  }, []);

  // Validate any stored paid session — dismiss banner if session is expired/deleted
  useEffect(() => {
    const sId = sessionStorage.getItem('gaslamar_session') ?? localStorage.getItem('gaslamar_session') ?? '';
    if (!sId.startsWith('sess_')) return;

    (async () => {
      try {
        const res = await fetch(`${WORKER_URL}/check-session?session=${encodeURIComponent(sId)}`, { credentials: 'include' });
        const isTerminal = !res.ok || (res.ok && (await res.json() as { status?: string }).status === 'deleted');
        if (isTerminal) {
          clearClientSessionData(sId);
          setNotices(prev => prev.filter(n => !n.link?.href.includes('download.html')));
        }
      } catch (_) {
        // Network error — leave banner; download.html will handle the expired state
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync back-navigation (BFcache restore)
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) setLoading(false);
    }
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  function handleFileSelect(file: File) {
    STALE_KEYS.forEach(k => { try { sessionStorage.removeItem(k); } catch (_) {} });
    setFileError('');
    setScanWarning(false);
    setCvText('');
    setManualCvText('');

    const err = validateFile(file);
    if (err) {
      setFileError(err);
      setFileName(null);
      setFileSize(null);
      (window as any).Analytics?.track?.('file_validation_failed', {
        reason: 'wrong_type_or_size',
        file_ext: '.' + file.name.split('.').pop()!.toLowerCase(),
        file_size_kb: Math.round(file.size / 1024),
      });
      return;
    }

    setFileName(file.name);
    setFileSize(formatFileSize(file.size));
    try { sessionStorage.setItem('gaslamar_upload_start', String(Date.now())); } catch (_) {}
    (window as any).Analytics?.track?.('file_selected', { method: 'input' });

    readFileAsEncodedBlob(file)
      .then(blob => {
        if (blob.trim().length < MIN_CV_TEXT_LENGTH) {
          setScanWarning(true);
          setCvText('');
        } else {
          setScanWarning(false);
          setCvText(blob);
          try {
            sessionStorage.setItem('gaslamar_cv_draft', blob);
            sessionStorage.setItem('gaslamar_filename_draft', file.name);
          } catch (_) {}
          handleCVUploaded();
        }
      })
      .catch(readErr => {
        setFileError((readErr as Error).message);
        setCvText('');
        setFileName(null);
        setFileSize(null);
      });
  }

  function handleCVUploaded() {
    if (jd.trim()) return;
    setTimeout(() => {
      jdRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      jdRef.current?.focus();
    }, 300);
  }

  function handleRemove() {
    setFileName(null);
    setFileSize(null);
    setCvText('');
    setManualCvText('');
    setFileError('');
    setScanWarning(false);
    try {
      sessionStorage.removeItem('gaslamar_cv_draft');
      sessionStorage.removeItem('gaslamar_filename_draft');
      sessionStorage.removeItem('gaslamar_jd_draft');
    } catch (_) {}
    setJd('');
  }

  function handleManualCvChange(value: string) {
    const next = value.slice(0, 60000);
    setManualCvText(next);
    setScanWarning(false);
    setFileError('');

    if (next.trim().length >= MIN_CV_TEXT_LENGTH) {
      const encoded = JSON.stringify({ type: 'txt', data: next });
      setCvText(encoded);
      setFileName('CV dari paste');
      setFileSize('(teks ditempel)');
      try {
        sessionStorage.setItem('gaslamar_cv_draft', encoded);
        sessionStorage.setItem('gaslamar_filename_draft', 'CV dari paste');
      } catch (_) {}
    } else if (!fileName || fileSize === '(teks ditempel)') {
      setCvText('');
      setFileName(null);
      setFileSize(null);
      try {
        sessionStorage.removeItem('gaslamar_cv_draft');
        sessionStorage.removeItem('gaslamar_filename_draft');
      } catch (_) {}
    }
  }

  function handleJdChange(value: string) {
    // Strip null bytes and non-printable control characters (keep tab, LF, CR).
    const sanitized = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    setJd(sanitized);
    try {
      if (sanitized.trim()) {
        sessionStorage.setItem('gaslamar_jd_draft', escapeHtml(sanitized));
      } else {
        sessionStorage.removeItem('gaslamar_jd_draft');
      }
    } catch (_) {}
  }

  function handleSubmit() {
    if (!hasFile) {
      setFileError('Mohon upload CV kamu terlebih dahulu.');
      return;
    }
    const jobDesc = jd.trim();
    if (!evaluateJDQuality(jobDesc).isValid) return;

    setLoading(true);
    try {
      const safeJd = jobDesc.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      sessionStorage.setItem('gaslamar_cv_pending', cvText);
      sessionStorage.setItem('gaslamar_jd_pending', escapeHtml(safeJd));
      sessionStorage.setItem('gaslamar_filename',   fileName!);
      sessionStorage.setItem('gaslamar_had_jd',     safeJd.length >= 50 ? '1' : '0');
    } catch (_) {
      setFileError('Browser kamu memblokir penyimpanan sementara (mode pribadi?). Coba gunakan mode normal.');
      setLoading(false);
      return;
    }

    (window as any).Analytics?.track?.('upload_submitted', { jd_length: jobDesc.length });
    window.location.href = 'analyzing.html';
  }

  const noticeCls: Record<NoticeType, string> = {
    info:    'bg-blue-50 border border-blue-200 text-blue-800',
    warning: 'bg-amber-50 border border-amber-200 text-amber-800',
    error:   'bg-red-50 border border-red-200 text-red-800',
  };

  return (
    <div
      className="min-h-screen w-full overflow-x-hidden text-gray-900 font-sans"
      style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(37,99,235,0.07), transparent)' }}
    >
      {/* Skip link */}
      <a
        href="#upload-form"
        className="absolute left-[-9999px] top-0 z-[9999] bg-slate-900 text-white px-4 py-2 text-sm font-semibold rounded-br-lg focus:left-0"
      >
        Langsung ke form upload
      </a>

      {/* Navbar */}
      <nav
        className="border-b py-4 px-6 flex items-center sticky top-0 z-50 backdrop-blur-[14px]"
        style={{ borderColor: 'rgba(148,163,184,0.18)', background: 'rgba(255,255,255,0.88)' }}
      >
        <a href="index.html" className="no-underline min-h-[44px] inline-flex items-center">
          <img src="assets/logo.svg" alt="GasLamar" height="28" style={{ display: 'block' }} />
        </a>
      </nav>

      <main className="w-full max-w-screen-xl mx-auto px-6 pt-12 pb-8" id="upload-form">

        {/* Notices */}
        {notices.map((n, i) => (
          <div key={i} className={`rounded-[16px] px-4 py-3 text-sm mb-4 ${noticeCls[n.type]}`} role="status">
            {n.text}
            {n.link && (
              <> <a href={n.link.href} className="font-semibold underline ml-1">{n.link.label}</a></>
            )}
          </div>
        ))}

        {/* ZONE 1: Hero */}
        <div className="text-center mb-10">
          <h1
            className="font-bold leading-[1.1] text-slate-900 mb-0 mx-auto"
            style={{
              fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif',
              letterSpacing: '-0.03em',
              fontSize: 'clamp(2.6rem, 6vw, 4rem)',
            }}
          >
            Cek peluang{' '}
            <span className="relative inline-block whitespace-nowrap">
              interview
              <svg
                className="absolute left-0 w-full overflow-visible pointer-events-none"
                style={{ bottom: '-4px' }}
                height="9"
                viewBox="0 0 100 9"
                preserveAspectRatio="none"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M1 6.5C18 3 42 8 62 5.8C76 4.4 90 7.5 99 5.5"
                  stroke="#1B4FE8"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  opacity="0.42"
                />
              </svg>
            </span>
            {' '}kamu
          </h1>

          <p className="text-[15px] text-slate-500 max-w-[44ch] mx-auto mt-5 leading-relaxed">
            Upload CV + job description —{' '}
            lihat apa yang bikin HR masih ragu.
          </p>

          {/* Progression strip */}
          <div className="mt-5 flex items-center justify-center gap-2 text-sm text-slate-500 flex-wrap">
            <span className="font-medium text-slate-700">Upload CV</span>
            <span className="text-slate-300" aria-hidden="true">→</span>
            <span>Analisis</span>
            <span className="text-slate-300" aria-hidden="true">→</span>
            <span>Hasil</span>
          </div>
        </div>

        {/* ZONE 2: Form panel */}
        <div
          className="w-full rounded-[24px] px-4 py-5 sm:px-8 sm:py-8 max-w-4xl mx-auto"
          style={{
            background:     'rgba(255,255,255,0.90)',
            border:         '1px solid rgba(148,163,184,0.13)',
            boxShadow:      SHADOW,
            backdropFilter: 'blur(14px)',
          }}
        >
          <TierIndicator tier={tier} />

          {/* CV upload */}
          <div className="mb-6">
            <CvDropzone
              fileName={fileName}
              fileSize={fileSize}
              error={fileError}
              cvReady={hasFile}
              scanWarning={scanWarning}
              manualCvText={manualCvText}
              onManualCvChange={handleManualCvChange}
              onFileSelect={handleFileSelect}
              onRemove={handleRemove}
            />
          </div>

          {/* Job target */}
          <div className="border-t pt-5" style={{ borderColor: 'rgba(148,163,184,0.10)' }}>
            <JobDescriptionInput
              ref={jdRef}
              value={jd}
              onChange={handleJdChange}
            />
          </div>

          <SubmitSection
            isValid={isValid}
            isLoading={loading}
            onSubmit={handleSubmit}
          />
        </div>

        <a
          href="mailto:support@gaslamar.com?subject=Bantuan%20Upload%20CV%20-%20GasLamar"
          className="block text-center mt-6 text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          Butuh bantuan? Hubungi support
        </a>
      </main>

      <footer className="text-center py-6 text-xs text-slate-400">
        <p className="mb-2 text-slate-400">GasLamar · Bantu kamu lebih pede apply</p>
        <div className="mt-1 space-x-1 text-slate-300">
          <a href="privacy.html" className="hover:text-slate-500 hover:underline mx-1">Kebijakan Privasi</a>
          ·
          <a href="terms.html" className="hover:text-slate-500 hover:underline mx-1">Syarat Layanan</a>
          ·
          <a href="accessibility.html" className="hover:text-slate-500 hover:underline mx-1">Aksesibilitas</a>
        </div>
      </footer>
    </div>
  );
}
