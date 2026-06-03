import { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import TierIndicator       from '@/components/upload/TierIndicator';
import UploadSteps         from '@/components/upload/UploadSteps';
import CvDropzone          from '@/components/upload/CvDropzone';
import JobDescriptionInput from '@/components/upload/JobDescriptionInput';
import SubmitSection       from '@/components/upload/SubmitSection';
import {
  VALID_TIERS,
  MIN_CV_TEXT_LENGTH,
  MIN_CV_PASTE_LENGTH,
  validateFile,
  formatFileSize,
  readFileAsEncodedBlob,
  escapeHtml,
  unescapeHtml,
} from '@/lib/uploadValidation';
import { evaluateJDQuality }          from '@/utils/evaluateJDQuality';
import { WORKER_URL, clearClientSessionData } from '@/lib/sessionUtils';
import { PAGE_BG, NAV_STYLE, MAIN_CONTAINER_CLASS, MAIN_CONTAINER_MAX } from '@/lib/pageChrome';

const SHADOW = '0 18px 44px rgba(15,23,42,0.07), 0 1px 2px rgba(15,23,42,0.04)';

type NoticeType = 'info' | 'warning' | 'error';
interface Notice {
  type: NoticeType;
  text: string;
  link?: { href: string; label: string };
}

function prioritizeNotices(items: Notice[]): Notice[] {
  if (!items.length) return items;
  const rank: Record<NoticeType, number> = { error: 3, warning: 2, info: 1 };
  const sorted = [...items].sort((a, b) => rank[b.type] - rank[a.type]);
  const primary = sorted[0];
  const secondary = sorted.find(n => n !== primary && n.type === 'info');
  return secondary ? [primary, secondary] : [primary];
}

const STALE_KEYS = [
  'gaslamar_cv_key', 'gaslamar_cv_pending', 'gaslamar_jd_pending',
  'gaslamar_filename', 'gaslamar_tier', 'gaslamar_analyze_time',
  'gaslamar_cv_draft', 'gaslamar_filename_draft',
  'gaslamar_6d_scores', 'gaslamar_skor', 'gaslamar_skor_sesudah', 'gaslamar_gap',
  // Legacy keys cleared for backward compat — no longer written
  'gaslamar_scoring', 'gaslamar_cv_paste_raw', 'gaslamar_result_id',
  'gaslamar_candidate_name', 'gaslamar_entitas_klaim',
  'gaslamar_sample', 'gaslamar_sample_line', 'gaslamar_sample_context',
  'gaslamar_sample_fallback', 'gaslamar_preview_after',
];

export default function Upload() {
  // CV state
  const [fileName,    setFileName]    = useState<string | null>(null);
  const [fileSize,    setFileSize]    = useState<string | null>(null);
  const [cvText,      setCvText]      = useState('');
  const [manualCvText, setManualCvText] = useState('');
  const [fileError,   setFileError]   = useState('');
  const [scanWarning, setScanWarning] = useState(false);
  // Raw CV paste text is not persisted to sessionStorage (security: no CV content in storage).
  const [cvTab, setCvTab] = useState<'upload' | 'paste'>('upload');

  // JD state
  const [jd, setJd] = useState('');

  // UI
  const [loading,        setLoading]        = useState(false);
  const [submitted,      setSubmitted]      = useState(false);
  const [tier,           setTier]           = useState<string | null>(null);
  const [notices,        setNotices]        = useState<Notice[]>([]);
  const [jdSubmitError,  setJdSubmitError]  = useState('');

  // JD textarea ref — used for auto-scroll after CV upload
  const jdRef       = useRef<HTMLTextAreaElement | null>(null);
  // CV section ref — used to scroll-to on missing CV validation
  const cvSectionRef = useRef<HTMLDivElement | null>(null);

  // Derived — JD is mandatory and must pass basic structure checks.
  const hasFile: boolean = !!fileName && !!cvText;
  const jdQuality = evaluateJDQuality(jd);

  // Context-aware CV hint text for the submit button — avoids "Upload CV kamu dulu"
  // when user is actively pasting but hasn't reached the 1,500-char minimum yet.
  const cvHintText: string = (() => {
    if (cvTab === 'paste') {
      const pasteLen = manualCvText.trim().length;
      if (pasteLen === 0) return 'Paste isi CV kamu di kotak di atas';
      return `Teks CV masih kurang panjang — tambahkan hingga min. ${MIN_CV_PASTE_LENGTH.toLocaleString('id-ID')} karakter`;
    }
    return 'Upload CV kamu untuk memulai analisis';
  })();

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
    }

    // new_package=1: user came from download page to buy a new package.
    // Skip the "already paid" banner and show a CV-reuse notice instead.
    const isNewPackage = params.get('new_package') === '1';
    if (isNewPackage) {
      params.delete('new_package');
      history.replaceState(null, '', params.toString() ? `${location.pathname}?${params}` : location.pathname);
      const hasCvDraft = !!(
        sessionStorage.getItem('gaslamar_cv_pending') ||
        sessionStorage.getItem('gaslamar_cv_draft')
      );
      newNotices.push({
        type: 'info',
        text: hasCvDraft
          ? 'CV kamu sebelumnya sudah siap — langsung isi job description untuk paket baru, atau ganti CV di bawah.'
          : 'Upload CV kamu dan isi job description untuk membeli paket baru.',
      });
    }

    // Paid session recovery: user has a session from a previous payment.
    // Show a banner directing them back to download, and suppress reason-based notices.
    let hasPaidSession = false;
    if (!isNewPackage) {
      try {
        const sessStorage = sessionStorage.getItem('gaslamar_session');
        const sessLocal   = localStorage.getItem('gaslamar_session');
        if (
          (sessStorage && sessStorage.startsWith('sess_')) ||
          (sessLocal   && sessLocal.startsWith('sess_'))
        ) {
          hasPaidSession = true;
          newNotices.push({
            type: 'info',
            text: 'Kamu sudah upload CV sebelumnya.',
            link: { href: 'download.html', label: 'Lanjutkan ke download' },
          });
        }
      } catch (_) {}
    }

    if (!isNewPackage && !hasPaidSession) {
      const reason = params.get('reason');
      // Only show actionable redirect context — expiry notices belong on hasil.html.
      if (reason === 'missing_data') {
        history.replaceState(null, '', location.pathname);
        newNotices.push({ type: 'warning', text: 'Data sesi tidak lengkap. Silakan upload CV kamu untuk memulai.' });
      } else if (reason === 'interrupted') {
        history.replaceState(null, '', location.pathname);
        newNotices.push({ type: 'warning', text: 'Analisis terputus — silakan upload ulang CV kamu untuk memulai.' });
      } else if (reason) {
        // Discard all other reason codes (session_expired, cv_expired, no_session, etc.)
        // so no contradictory message appears alongside the server-checked active-results banner.
        history.replaceState(null, '', location.pathname);
      }

      const uploadErr = sessionStorage.getItem('gaslamar_upload_error');
      if (uploadErr) {
        sessionStorage.removeItem('gaslamar_upload_error');
        newNotices.push({ type: 'error', text: 'Analisis gagal: ' + uploadErr });
      }
      // Active analysis notice is now populated by the /check-session effect below,
      // not from sessionStorage, to avoid contradictions with server state.
    }

    if (newNotices.length) setNotices(prioritizeNotices(newNotices));

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

  // Single server-side session check — drives both the "active analysis" notice and
  // the payment session cleanup. Replaces all sessionStorage-based state detection
  // to prevent contradictory messages.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${WORKER_URL}/check-session`, { credentials: 'include' });
        if (!res.ok) return; // non-200 = server error — leave banners as-is
        const data = await res.json() as { valid?: boolean; status?: string; type?: string };

        if (data?.valid && data?.type === 'analysis') {
          // cv_key cookie is live and KV entry exists — show the single active-results prompt.
          setNotices(prev => {
            if (prev.some(n => n.link?.href === 'hasil.html')) return prev; // deduplicate
            return [...prev, {
              type: 'info',
              text: 'Anda memiliki hasil analisis aktif.',
              link: { href: 'hasil.html', label: 'Lihat hasil →' },
            }];
          });
        } else if (data?.status === 'deleted' || data?.status === 'pending') {
          // Payment session is terminal — clear stale client storage and dismiss download banner.
          clearClientSessionData(null);
          setNotices(prev => prev.filter(n => !n.link?.href.includes('download.html')));
        }
        // valid: false for analysis (expired/absent) → show no message; user is on the upload form.
      } catch (_) {
        // Network error — leave banners as-is; respective pages handle their own state.
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
    setJdSubmitError('');
    setScanWarning(false);
    try {
      sessionStorage.removeItem('gaslamar_cv_draft');
      sessionStorage.removeItem('gaslamar_filename_draft');
    } catch (_) {}
    // JD is intentionally preserved — user is only changing their CV, not starting over.
  }

  function handleManualCvChange(value: string) {
    const next = value.slice(0, 60000);
    setManualCvText(next);
    setScanWarning(false);
    setFileError('');

    // Raw paste text is held only in React state — not persisted to sessionStorage.

    if (next.trim().length >= MIN_CV_PASTE_LENGTH) {
      const encoded = JSON.stringify({ type: 'txt', data: next });
      setCvText(encoded);
      setFileName('CV dari paste');
      setFileSize('(teks ditempel)');
      try {
        sessionStorage.setItem('gaslamar_cv_draft', encoded);
        sessionStorage.setItem('gaslamar_filename_draft', 'CV dari paste');
      } catch (_) {}
    } else {
      // Clear any previously set CV data (whether from file upload or a prior valid paste)
      // when paste text drops below the minimum. Without this, a user who uploaded a file
      // and then switches to the paste tab would submit the old file payload instead of
      // the short paste text they are editing.
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
    if (jdSubmitError) setJdSubmitError('');
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
    if (loading) return;
    const cvMissing = !hasFile;
    const jdMissing = !evaluateJDQuality(jd).isValid;

    if (cvMissing) {
      const pasteIsTooShort = cvTab === 'paste' && manualCvText.trim().length > 0;
      setFileError(
        pasteIsTooShort
          ? `Terlalu singkat — tambahkan detail hingga minimal ${MIN_CV_PASTE_LENGTH.toLocaleString('id-ID')} karakter`
          : 'Masukkan CV dulu ya'
      );
    }

    if (jdMissing) {
      setJdSubmitError('Tambahkan job description posisi yang kamu lamar dulu ya');
    }

    if (cvMissing || jdMissing) {
      if (cvMissing) {
        cvSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        jdRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        jdRef.current?.focus();
      }
      return;
    }

    // flushSync forces a synchronous re-render so the button is visibly disabled
    // before sessionStorage writes and navigation — this also prevents rapid
    // double-clicks from invoking handleSubmit again before React re-renders.
    flushSync(() => setLoading(true));

    try {
      const safeJd = jd.trim().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      sessionStorage.setItem('gaslamar_cv_pending', cvText);
      sessionStorage.setItem('gaslamar_jd_pending', escapeHtml(safeJd));
      sessionStorage.setItem('gaslamar_filename',   fileName!);
      sessionStorage.setItem('gaslamar_had_jd',     safeJd.length >= 50 ? '1' : '0');
    } catch (_) {
      setFileError('Browser kamu memblokir penyimpanan sementara (mode pribadi?). Coba gunakan mode normal.');
      setLoading(false);
      return;
    }

    (window as any).Analytics?.track?.('upload_submitted', { jd_length: jd.trim().length });

    flushSync(() => setSubmitted(true));
    setTimeout(() => { window.location.href = tier ? 'analyzing.html?tier=' + encodeURIComponent(tier) : 'analyzing.html'; }, 1500);
  }

  const noticeCls: Record<NoticeType, string> = {
    info:    'bg-blue-50 border border-blue-200 text-blue-800',
    warning: 'bg-amber-50 border border-amber-200 text-amber-800',
    error:   'bg-red-50 border border-red-200 text-red-800',
  };

  return (
    <div
      className="min-h-dvh w-full overflow-x-hidden text-gray-900 font-sans"
      style={{ background: PAGE_BG }}
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
        style={NAV_STYLE}
      >
        <a href="index.html" className="no-underline min-h-[44px] inline-flex items-center">
          <img src="assets/logo.svg" alt="GasLamar" height="28" style={{ display: 'block' }} />
        </a>
      </nav>

      <main className={MAIN_CONTAINER_CLASS} style={{ maxWidth: MAIN_CONTAINER_MAX }} id="upload-form">

        {/* Notices */}
        {notices.map((n, i) => (
          <div key={i} className={`rounded-[16px] px-4 py-3 text-sm mb-4 ${noticeCls[n.type]}`} role={n.type === 'error' ? 'alert' : 'status'}>
            {n.text}
            {n.link && (
              <> <a href={n.link.href} className="font-semibold underline ml-1">{n.link.label}</a></>
            )}
          </div>
        ))}

        {/* ZONE 1: Hero */}
        <div className="text-center mb-8">
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
            Lihat apa yang bikin HR masih ragu.
          </p>

        </div>

        {/* ZONE 2: Form panel */}
        <div
          className="w-full rounded-[24px] px-4 py-5 sm:px-8 sm:py-8 max-w-4xl mx-auto"
          style={{
            background:     'rgba(255,255,255,0.92)',
            border:         '1px solid rgba(148,163,184,0.14)',
            boxShadow:      SHADOW,
            backdropFilter: 'blur(14px)',
          }}
        >
          <UploadSteps currentStep={1} />
          <TierIndicator tier={tier} />

          {/* CV upload */}
          <div className="mb-6" ref={cvSectionRef}>
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
              onTabChange={setCvTab}
              defaultTab={cvTab}
            />
          </div>

          {/* Job target */}
          <div className="border-t pt-5" style={{ borderColor: 'rgba(148,163,184,0.10)' }}>
            <JobDescriptionInput
              ref={jdRef}
              value={jd}
              onChange={handleJdChange}
              submitError={jdSubmitError}
              onSubmit={handleSubmit}
            />
          </div>

          <SubmitSection
            isLoading={loading}
            isSubmitted={submitted}
            hasCv={hasFile}
            showJdHint={jd.trim().length < 100}
            jdHintText={jd.trim().length === 0
              ? 'Job description wajib diisi agar analisis bisa dimulai.'
              : 'Job description terlalu pendek (min. 100 karakter).'}
            cvHintText={hasFile ? undefined : cvHintText}
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
        <div className="mt-1 space-x-1 text-slate-500">
          <a href="privacy.html" className="hover:text-slate-700 hover:underline mx-1">Kebijakan Privasi</a>
          ·
          <a href="terms.html" className="hover:text-slate-700 hover:underline mx-1">Syarat Layanan</a>
          ·
          <a href="accessibility.html" className="hover:text-slate-700 hover:underline mx-1">Aksesibilitas</a>
        </div>
      </footer>
    </div>
  );
}
