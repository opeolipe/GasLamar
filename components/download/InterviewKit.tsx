import { useState, useEffect, useRef } from 'react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { copyToClipboard, buildSecretHeaders, WORKER_URL } from '@/lib/sessionUtils';
import { logError } from '@/lib/logger';
import LoadingPlaceholder from '@/components/ui/LoadingPlaceholder';

interface InterviewKitData {
  job_insights:           { phrase: string; meaning: string }[];
  email_template:         { subject: string; body: string };
  whatsapp_message:       string;
  tell_me_about_yourself: string;
  interview_questions:    { question_id: string; question_en: string; sample_answer: string }[];
}

interface InterviewKitProps {
  sessionSecret: string | null;
  isPreview?: boolean;
  language?: 'id' | 'en';
  initialKit?: unknown | null;
}

function isValidKit(v: unknown): v is InterviewKitData {
  if (!v || typeof v !== 'object') return false;
  const k = v as Record<string, unknown>;
  return (
    Array.isArray(k.job_insights) &&
    k.email_template !== null && k.email_template !== undefined && typeof k.email_template === 'object' &&
    typeof k.whatsapp_message === 'string' &&
    typeof k.tell_me_about_yourself === 'string' &&
    Array.isArray(k.interview_questions)
  );
}

function CopyButton({ text, copyKey, copiedKey, onCopy }: {
  text: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  const copied = copiedKey === copyKey;
  return (
    <button
      onClick={() => onCopy(text, copyKey)}
      className="min-h-[44px] min-w-[44px] px-3 rounded-[10px] text-sm font-semibold transition-colors"
      style={{
        background: copied ? '#F0FDF4' : '#EFF6FF',
        border: `1px solid ${copied ? '#86EFAC' : '#BFDBFE'}`,
        color: copied ? '#15803D' : '#1D4ED8',
      }}
    >
      {copied ? '✓ Disalin!' : 'Salin'}
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold tracking-widest uppercase text-slate-400 mt-5 mb-2 px-1">
      {children}
    </p>
  );
}

export default function InterviewKit({ sessionSecret, isPreview = false, language = 'id', initialKit = null }: InterviewKitProps) {
  const [cache, setCache]           = useState<Partial<Record<'id' | 'en', InterviewKitData>>>(() =>
    isValidKit(initialKit) ? { [language]: initialKit as InterviewKitData } : {}
  );
  const [activeLang, setActiveLang] = useState<'id' | 'en'>(language);
  const [loading, setLoading]       = useState(!isValidKit(initialKit));
  const [error, setError]           = useState<string | null>(null);
  const [copiedKey, setCopiedKey]   = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const sessionSecretRef            = useRef(sessionSecret);
  sessionSecretRef.current          = sessionSecret;

  const kit = cache[activeLang] ?? null;

  useEffect(() => {
    // Already cached — show immediately, no fetch needed
    if (cache[activeLang] !== undefined && retryCount === 0) {
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30000);

    async function fetchKit() {
      try {
        const res = await fetch(`${WORKER_URL}/interview-kit`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', ...buildSecretHeaders(sessionSecretRef.current) },
          credentials: 'include',
          body:    JSON.stringify({ language: activeLang }),
          signal:  ctrl.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as any).message || 'Gagal menghasilkan Interview Kit.');
        }
        const data = await res.json();
        if (cancelled) return;
        if (!isValidKit(data.kit)) {
          throw new Error('Interview Kit tidak lengkap. Coba lagi.');
        }
        setCache(prev => ({ ...prev, [activeLang]: data.kit }));
        setLoading(false);
      } catch (e: any) {
        clearTimeout(timeout);
        if (cancelled) return;
        const msg = e?.name === 'AbortError'
          ? 'Interview Kit timeout. Coba lagi.'
          : (e?.message || 'Interview Kit belum tersedia. Coba lagi.');
        logError('interview_kit_failed', { message: e?.message });
        setError(msg);
        setLoading(false);
      }
    }

    fetchKit();
    return () => { cancelled = true; clearTimeout(timeout); ctrl.abort(); };
  }, [activeLang, retryCount]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleLangSwitch(lang: 'id' | 'en') {
    if (lang === activeLang) return;
    setError(null);
    if (cache[lang] === undefined) setLoading(true);
    setActiveLang(lang);
  }

  async function handleCopy(text: string, key: string) {
    await copyToClipboard(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  return (
    <div
      className="rounded-[24px] p-6 sm:p-8 mt-8"
      style={{
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 18px 44px rgba(15, 23, 42, 0.08)',
        border: '1px solid rgba(226,232,240,0.8)',
      }}
    >
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800">Interview Kit</h2>
        <p className="text-sm text-slate-500 mt-1">
          Gunakan ini untuk langsung melamar dan menjawab pertanyaan pertama dengan percaya diri
        </p>
      </div>

      {/* Language tabs */}
      <div className="flex gap-2 mb-5">
        {(['id', 'en'] as const).map(lang => (
          <button
            key={lang}
            onClick={() => handleLangSwitch(lang)}
            className={`min-h-[44px] px-5 rounded-full font-semibold text-sm transition-all ${
              activeLang === lang
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-blue-300'
            }`}
          >
            {lang === 'id' ? 'Bahasa Indonesia' : 'English'}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && <LoadingPlaceholder text="Menyiapkan Interview Kit kamu…" />}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center py-8 text-center">
          <p className="text-sm text-red-600 mb-3">{error}</p>
          <button
            onClick={() => setRetryCount(c => c + 1)}
            className="min-h-[44px] min-w-[44px] px-4 rounded-full text-sm font-semibold bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 transition-colors"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* Kit content */}
      {!loading && !error && kit && (
        <Accordion type="single" collapsible>

          {/* ── Gunakan Sekarang ── */}
          <GroupLabel>Gunakan Sekarang</GroupLabel>

          {/* Email Template */}
          <AccordionItem value="item-email" className="border border-slate-100 rounded-[14px] mb-2 overflow-hidden">
            <AccordionTrigger className="min-h-[44px] px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              Email Lamaran
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-2">
              <p className="text-sm font-medium text-slate-500 mb-1">Subject:</p>
              <p className="text-sm text-slate-800 bg-slate-50 rounded-[10px] px-3 py-2 mb-3">{kit.email_template.subject}</p>
              <p className="text-sm font-medium text-slate-500 mb-1">Isi email:</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-[10px] px-3 py-2 mb-3">{kit.email_template.body}</p>
              <CopyButton
                text={`Subject: ${kit.email_template.subject}\n\n${kit.email_template.body}`}
                copyKey="email"
                copiedKey={copiedKey}
                onCopy={handleCopy}
              />
            </AccordionContent>
          </AccordionItem>

          {/* WhatsApp */}
          <AccordionItem value="item-whatsapp" className="border border-slate-100 rounded-[14px] mb-2 overflow-hidden">
            <AccordionTrigger className="min-h-[44px] px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              Pesan WhatsApp
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-2">
              <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-[10px] px-3 py-2 mb-3">{kit.whatsapp_message}</p>
              <CopyButton
                text={kit.whatsapp_message}
                copyKey="whatsapp"
                copiedKey={copiedKey}
                onCopy={handleCopy}
              />
            </AccordionContent>
          </AccordionItem>

          {/* Tell Me About Yourself */}
          <AccordionItem value="item-tmay" className="border border-slate-100 rounded-[14px] mb-2 overflow-hidden">
            <AccordionTrigger className="min-h-[44px] px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              "Tell Me About Yourself"
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-2">
              <p className="text-sm text-slate-400 mb-2">Jawaban pembuka ~45-60 detik</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-[10px] px-3 py-2 mb-3">{kit.tell_me_about_yourself}</p>
              <CopyButton
                text={kit.tell_me_about_yourself}
                copyKey="tmay"
                copiedKey={copiedKey}
                onCopy={handleCopy}
              />
            </AccordionContent>
          </AccordionItem>

          {/* ── Persiapkan ── */}
          <GroupLabel>Persiapkan</GroupLabel>

          {/* Interview Questions */}
          <AccordionItem value="item-questions" className="border border-slate-100 rounded-[14px] mb-2 overflow-hidden">
            <AccordionTrigger className="min-h-[44px] px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              Pertanyaan Interview ({kit.interview_questions.length})
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-2">
              <div className="flex flex-col gap-4">
                {kit.interview_questions.map((q, index) => {
                  const isBlurred = isPreview && index > 0;
                  return (
                    <div
                      key={index}
                      className="rounded-[12px] border border-slate-100 p-3"
                      style={isBlurred ? { filter: 'blur(4px)', userSelect: 'none', pointerEvents: 'none' } : undefined}
                    >
                      <p className="text-sm font-bold text-blue-600 mb-1">Pertanyaan {index + 1}</p>
                      <p className="text-sm font-semibold text-slate-800 mb-2">
                        {activeLang === 'en' ? q.question_en : q.question_id}
                      </p>
                      <p className="text-sm font-medium text-slate-500 mb-1">Contoh jawaban (STAR):</p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-[10px] px-3 py-2 mb-2">{q.sample_answer}</p>
                      <CopyButton
                        text={q.sample_answer}
                        copyKey={`q-${index}-answer`}
                        copiedKey={copiedKey}
                        onCopy={handleCopy}
                      />
                    </div>
                  );
                })}
              </div>

              {isPreview && (
                <div
                  className="rounded-[16px] p-4 mt-4 text-center"
                  style={{ background: 'rgba(37,99,235,0.05)', border: '1px dashed rgba(37,99,235,0.3)' }}
                >
                  <p className="font-semibold text-slate-700 text-sm mb-2">Upgrade untuk membuka Interview Kit lengkap</p>
                  <a
                    href="/"
                    className="inline-flex items-center min-h-[44px] px-4 rounded-full font-bold text-white text-sm"
                    style={{ background: 'linear-gradient(180deg,#2563eb,#1d4ed8)' }}
                  >
                    Upgrade Sekarang
                  </a>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* ── Insight ── */}
          <GroupLabel>Insight</GroupLabel>

          {/* Job Description Analysis */}
          <AccordionItem value="item-insights" className="border border-slate-100 rounded-[14px] mb-2 overflow-hidden">
            <AccordionTrigger className="min-h-[44px] px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              Analisis Job Description
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-2">
              <div className="flex flex-col gap-3">
                {kit.job_insights.map((insight, index) => (
                  <div key={index} className="rounded-[10px] bg-slate-50 px-3 py-2">
                    <p className="text-sm font-bold text-slate-700 mb-0.5">"{insight.phrase}"</p>
                    <p className="text-sm text-slate-600">{insight.meaning}</p>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

        </Accordion>
      )}
    </div>
  );
}
