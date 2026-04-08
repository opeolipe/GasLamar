/**
 * download.js — GasLamar
 * Handles: session polling, CV generation via Worker, DOCX + PDF generation client-side
 * Requires: js/config.js (defines WORKER_URL)
 */

const POLL_INTERVAL = 3000;  // 3 seconds
const MAX_POLLS = 10;
const HEARTBEAT_INTERVAL = 3 * 60 * 1000; // 3 minutes

let pollCount = 0;
let notFoundCount = 0; // consecutive 404s — separate from pollCount for faster invalid-session detection
let pollTimer = null;
let heartbeatTimer = null;
let cvDataCache = null; // { cv_id: string, cv_en: string, tier: string, total_credits: number, job_title: string|null, company: string|null }
let sessionIdCache = null; // retained for multi-credit re-use
let sessionSecretCache = null; // retained for X-Session-Secret header

// ---- Init ----

(function init() {
  // Get session from URL or localStorage fallback
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session') || localStorage.getItem('gaslamar_session');

  if (!sessionId) {
    showSessionError('Sesi tidak ditemukan', 'Link download tidak valid. Coba lagi dari awal.');
    return;
  }

  if (!sessionId.startsWith('sess_')) {
    showSessionError('Link Tidak Valid', 'Link download tidak valid. Pastikan menggunakan link lengkap yang dikirim ke email kamu.');
    return;
  }

  sessionIdCache = sessionId;
  // Read the client secret bound to this session (stored by payment.js)
  sessionSecretCache = localStorage.getItem('gaslamar_secret_' + sessionId);

  // Start polling for payment confirmation
  showState('waiting-payment');
  startPolling(sessionId);
})();

// ---- Polling ----

function startPolling(sessionId) {
  pollCount = 0;
  notFoundCount = 0;
  // 2s delay before first poll — Cloudflare KV is eventually consistent;
  // the session written by /create-payment may not be visible at the polling
  // edge node for several seconds.
  setTimeout(() => poll(sessionId), 2000);
}

function restartPolling() {
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session') || localStorage.getItem('gaslamar_session');
  if (!sessionId) {
    showSessionError('Sesi tidak ditemukan', 'Link download tidak valid.');
    return;
  }
  document.getElementById('check-btn').classList.add('hidden');
  document.getElementById('contact-btn').classList.add('hidden');
  startPolling(sessionId);
}

async function poll(sessionId) {
  pollCount++;
  updatePollUI();

  try {
    const res = await fetch(`${WORKER_URL}/check-session?session=${encodeURIComponent(sessionId)}`);

    if (res.status === 400) {
      // Bad request — invalid session ID format; no point retrying
      showSessionError(
        'Link Tidak Valid',
        'Link download tidak valid. Pastikan menggunakan link lengkap yang dikirim ke email kamu.',
        false
      );
      return;
    }

    if (res.status === 404) {
      notFoundCount++;
      // Cloudflare KV is eventually consistent — allow up to 4 consecutive 404s
      // (~12 seconds) before declaring the session invalid. This is enough time
      // for KV propagation after a real payment, while failing fast for
      // invalid/expired tokens instead of making the user wait 30 seconds.
      if (notFoundCount < 4) {
        updatePollUI();
        scheduleNextPoll(sessionId);
        return;
      }
      showSessionError(
        'Sesi Tidak Valid atau Kedaluwarsa',
        'Sesi tidak ditemukan. Jika kamu baru saja membayar, coba refresh halaman ini. Jika masalah berlanjut, hubungi support@gaslamar.com dengan bukti pembayaran.',
        false
      );
      return;
    }
    notFoundCount = 0; // reset on any non-404 response

    if (!res.ok) {
      scheduleNextPoll(sessionId);
      return;
    }

    const data = await res.json();
    const { status } = data;

    if (status === 'paid' || status === 'generating') {
      clearTimeout(pollTimer);
      startSessionHeartbeat(sessionId); // keep session alive while user is on the page
      const creditsRemaining = data.credits_remaining ?? 1;
      const totalCredits = data.total_credits ?? 1;
      // Sync authoritative tier from server so animation shows the correct package label
      if (data.tier) sessionStorage.setItem('gaslamar_tier', data.tier);
      if (window.Analytics) Analytics.track('payment_confirmed', {
        tier: data.tier || undefined,
        total_credits: totalCredits,
        poll_attempts: pollCount,
      });
      // Returning user: already used ≥1 credit — show dashboard without auto-generating
      const isReturning = totalCredits > 1 && creditsRemaining < totalCredits;
      if (isReturning) {
        showCreditsDashboard(creditsRemaining, totalCredits, data.tier);
      } else {
        await fetchAndGenerateCV(sessionId);
      }
    } else if (status === 'pending') {
      if (pollCount >= MAX_POLLS) {
        // Stopped polling — show manual check buttons
        if (window.Analytics) Analytics.track('payment_timeout', { poll_attempts: pollCount });
        document.getElementById('check-btn').classList.remove('hidden');
        document.getElementById('poll-count-text').textContent = 'Klik tombol di bawah untuk cek ulang.';
        setTimeout(() => {
          document.getElementById('contact-btn').classList.remove('hidden');
        }, 300000); // Show contact after 5 minutes
      } else {
        scheduleNextPoll(sessionId);
      }
    } else {
      if (pollCount < MAX_POLLS) {
        scheduleNextPoll(sessionId);
      } else {
        document.getElementById('check-btn').classList.remove('hidden');
        document.getElementById('poll-count-text').textContent = 'Klik tombol di bawah untuk cek ulang.';
      }
    }
  } catch (err) {
    if (pollCount < MAX_POLLS) {
      scheduleNextPoll(sessionId);
    }
  }
}

function scheduleNextPoll(sessionId) {
  pollTimer = setTimeout(() => poll(sessionId), POLL_INTERVAL);
}

// ---- Session Heartbeat ----
// Pings /session/ping every 3 minutes to refresh KV TTL while user is active.

function startSessionHeartbeat(sessionId) {
  if (heartbeatTimer) return; // already running
  heartbeatTimer = setInterval(async () => {
    try {
      const secretHeaders = sessionSecretCache ? { 'X-Session-Secret': sessionSecretCache } : {};
      const res = await fetch(`${WORKER_URL}/session/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...secretHeaders },
        body: JSON.stringify({ session_id: sessionId })
      });
      if (res.status === 404) {
        stopSessionHeartbeat();
        showSessionError(
          'Sesi Kedaluwarsa',
          'Sesi kamu sudah kedaluwarsa. Jika kamu sudah membayar, hubungi kami dengan bukti pembayaran.',
          false
        );
      }
    } catch (_) { /* ignore transient network errors */ }
  }, HEARTBEAT_INTERVAL);
}

function stopSessionHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function updatePollUI() {
  const el = document.getElementById('poll-count-text');
  if (!el) return;
  if (notFoundCount > 0) {
    el.textContent = `Sesi belum ditemukan, mencoba lagi... (${notFoundCount}/4)`;
  } else {
    el.textContent = `Memeriksa status pembayaran...`;
  }
}

// ---- Fetch Session & Generate CV ----

async function fetchAndGenerateCV(sessionId) {
  showState('generating-cv');
  setProgress(10);
  setGeneratingText('Mengambil data CV...');
  if (window.Analytics) Analytics.track('cv_generation_started', {
    tier: sessionStorage.getItem('gaslamar_tier') || undefined,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const secretHeaders = sessionSecretCache ? { 'X-Session-Secret': sessionSecretCache } : {};
    const res = await fetch(`${WORKER_URL}/get-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...secretHeaders },
      body: JSON.stringify({ session_id: sessionId }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (res.status === 403) {
      showSessionError('Akses Ditolak', 'Pembayaran belum dikonfirmasi atau sesi tidak valid.', false);
      return;
    }

    if (res.status === 404) {
      showSessionError(
        'Sesi Tidak Ditemukan',
        'Sesi tidak ditemukan atau sudah kedaluwarsa. Jika kamu sudah membayar, hubungi support dengan bukti pembayaran.',
        false
      );
      return;
    }

    if (!res.ok) {
      throw new Error(`Server error: ${res.status}`);
    }

    const sessionData = await res.json();
    const { tier } = sessionData;

    setProgress(25);
    setGeneratingText('AI sedang menulis CV Bahasa Indonesia...');

    // Generate CV via Worker (cv and job_desc retrieved server-side from KV)
    await generateCVContent(sessionId, tier);

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      showSessionError('Timeout', 'Koneksi timeout. Coba refresh halaman ini.');
    } else {
      showSessionError('Terjadi Kesalahan', err.message || 'Gagal memproses CV. Coba refresh halaman.');
    }
  }
}

async function generateCVContent(sessionId, tier, newJobDesc) {
  // CV data is read from KV server-side — browser only sends session_id (and optional new job_desc)
  const isBilingual = tier !== 'coba';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s for generation

  try {
    setProgress(40);
    setGeneratingText('AI sedang menulis CV kamu...');

    const reqBody = { session_id: sessionId };
    if (newJobDesc) reqBody.job_desc = newJobDesc;
    // Pass score + gaps so worker can send post-generate email
    try {
      const scoring = JSON.parse(sessionStorage.getItem('gaslamar_scoring') || '{}');
      if (typeof scoring.score === 'number') reqBody.score = scoring.score;
      if (Array.isArray(scoring.gaps) && scoring.gaps.length) reqBody.gaps = scoring.gaps.slice(0, 3);
    } catch (_) { /* ignore */ }

    const secretHeaders = sessionSecretCache ? { 'X-Session-Secret': sessionSecretCache } : {};
    const res = await fetch(`${WORKER_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...secretHeaders },
      body: JSON.stringify(reqBody),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      // Parse server error message for better context
      let serverMsg = `Gagal generate CV (${res.status})`;
      try {
        const errData = await res.json();
        if (errData.message) serverMsg = errData.message;
      } catch (_) {}

      if (res.status === 404) {
        showSessionError(
          'Sesi Tidak Ditemukan',
          'Sesi tidak ditemukan atau sudah kedaluwarsa. Jika kamu sudah membayar, hubungi support dengan bukti pembayaran.',
          false
        );
        return;
      }
      if (res.status === 403) {
        showSessionError('Akses Ditolak', serverMsg, false);
        return;
      }
      // 500 / 429: server resets session to 'paid' on failure — user can retry
      showSessionError('Gagal Generate CV', serverMsg + ' Klik "Coba Lagi" untuk mencoba ulang.', true);
      return;
    }

    setProgress(75);
    setGeneratingText('Menyiapkan file download...');

    const { cv_id, cv_en, credits_remaining, total_credits, job_title, company } = await res.json();

    // Cache for retries
    cvDataCache = { cv_id, cv_en, tier, total_credits, job_title: job_title ?? null, company: company ?? null };
    if (window.Analytics) Analytics.track('cv_generated', {
      tier,
      is_bilingual: isBilingual,
      has_english: !!cv_en,
      credits_remaining: credits_remaining || 0,
    });

    // Only clear localStorage when all credits are used up
    if (!credits_remaining || credits_remaining <= 0) {
      localStorage.removeItem('gaslamar_session');
      localStorage.removeItem('gaslamar_tier');
    }

    setProgress(90);
    setGeneratingText('Hampir selesai...');

    // Show download UI
    setTimeout(() => {
      setProgress(100);
      stopSessionHeartbeat(); // CV is ready — no need to keep extending session
      showDownloadReady(cv_id, cv_en, tier, isBilingual, credits_remaining || 0);
    }, 500);

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      showSessionError('Timeout', 'Generate CV timeout. Refresh halaman untuk coba lagi.');
    } else {
      throw err;
    }
  }
}

// ---- Download Actions ----

function downloadFile(lang, format) {
  if (!cvDataCache) return;

  const { cv_id, cv_en, tier } = cvDataCache;
  if (window.Analytics) Analytics.track('cv_downloaded', { tier, language: lang, format });
  const cvText = lang === 'id' ? cv_id : cv_en;

  if (!cvText) {
    alert(lang === 'en' ? 'CV English tidak tersedia di paket ini.' : 'CV tidak tersedia.');
    return;
  }

  if (format === 'docx') {
    generateDOCX(cvText, lang, tier);
  } else if (format === 'pdf') {
    generatePDF(cvText, lang, tier);
  }
}

// ---- File Download Helper ----

function triggerDownload(blob, filename, mimeType) {
  const url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Candidate Name Extraction ----

function extractCandidateName(cvText) {
  if (!cvText) return null;
  // First short non-blank line is typically the candidate's name
  const firstLine = cvText.split('\n').map(l => l.trim()).find(l => l.length > 1 && l.length < 60);
  if (!firstLine) return null;
  // Sanitize: keep alphanumeric, spaces, hyphens only; collapse spaces to hyphens
  const sanitized = firstLine.replace(/[^a-zA-Z0-9\s\-]/g, '').trim().replace(/\s+/g, '-').slice(0, 30);
  return sanitized || null;
}

// ---- Filename Building ----

function sanitizeFilenamePart(raw, maxLen) {
  if (!raw) return null;
  const MAP = { 'é':'e','è':'e','ê':'e','ë':'e','à':'a','â':'a','ä':'a','î':'i','ï':'i',
                'ô':'o','ö':'o','ù':'u','û':'u','ü':'u','ç':'c','ñ':'n','ã':'a','õ':'o' };
  let s = raw.replace(/[éèêëàâäîïôöùûüçñãõ]/gi, c => MAP[c.toLowerCase()] || '');
  s = s.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-')
       .slice(0, maxLen).replace(/-+$/, '');
  return s || null;
}

function buildCVFilename(cvText, jobTitle, company, lang, ext) {
  // Name: first word of the first non-blank, non-all-uppercase line (skip section headings)
  const nameLine = cvText
    ? cvText.split('\n').map(l => l.trim())
        .find(l => l.length > 1 && l.length < 60 && !/^[A-Z\s]{4,}$/.test(l))
    : null;
  const firstName = nameLine ? sanitizeFilenamePart(nameLine.split(/\s+/)[0], 20) : null;

  const langLabel = lang === 'id' ? 'Indonesia' : 'English';

  const parts = [
    firstName,
    sanitizeFilenamePart(jobTitle, 20),
    sanitizeFilenamePart(company, 20),
    langLabel,
  ].filter(Boolean);

  if (parts.length === 1) return `CV-${langLabel}.${ext}`;
  return parts.join('_') + '.' + ext;
}

// ---- Line Parsing ----

/**
 * Parse CV text into an array of typed line objects.
 * Single source of truth for section-head and bullet detection —
 * used by both generateDOCX and generatePDF so format changes stay in sync.
 *
 * @param {string} cvText
 * @returns {{ type: 'heading'|'bullet'|'text'|'blank', content: string }[]}
 */
function parseLines(cvText) {
  return cvText.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return { type: 'blank', content: '' };

    const isSectionHead = /^[A-Z\u00C0-\u017E\s]{4,}$/.test(trimmed) ||
                          (trimmed.endsWith(':') && trimmed.length < 40);
    const isBullet = trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('·');

    if (isSectionHead) return { type: 'heading', content: trimmed.replace(/:$/, '') };
    if (isBullet)      return { type: 'bullet',  content: trimmed.replace(/^[•\-·]\s*/, '') };
    return { type: 'text', content: trimmed };
  });
}

// ---- DOCX Generation ----

function generateDOCX(cvText, lang, tier) {
  try {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = docx;

    const parsed = parseLines(cvText);
    const children = [];
    for (const { type, content } of parsed) {
      if (type === 'blank') {
        children.push(new Paragraph({ spacing: { after: 100 } }));
      } else if (type === 'heading') {
        children.push(new Paragraph({
          text: content,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 80 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } }
        }));
      } else if (type === 'bullet') {
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: 22, font: 'Calibri' })],
          bullet: { level: 0 },
          spacing: { after: 40 }
        }));
      } else {
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: 22, font: 'Calibri' })],
          spacing: { after: 60 }
        }));
      }
    }

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } // 2.54cm
          }
        },
        children
      }]
    });

    Packer.toBlob(doc).then(blob => {
      const filename = buildCVFilename(cvText, cvDataCache?.job_title, cvDataCache?.company, lang, 'docx');
      triggerDownload(blob, filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    });

  } catch (err) {
    console.error('DOCX generation error:', err);
    showMobileFallback();
    alert('Tidak bisa generate DOCX. Gunakan tombol salin teks di bawah.');
  }
}

// ---- PDF Generation ----

function generatePDF(cvText, lang, tier) {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 20;
    const marginY = 20;
    const contentWidth = pageWidth - marginX * 2;
    let y = marginY;

    const parsed = parseLines(cvText);
    doc.setFont('helvetica');

    for (const { type, content } of parsed) {
      if (type === 'blank') {
        y += 4;
        continue;
      }

      if (y > pageHeight - marginY) {
        doc.addPage();
        y = marginY;
      }

      if (type === 'heading') {
        y += 4;
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        const headText = content.toUpperCase();
        doc.text(headText, marginX, y);
        y += 1;
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.line(marginX, y, marginX + contentWidth, y);
        y += 5;
        doc.setDrawColor(0);

      } else if (type === 'bullet') {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const wrappedLines = doc.splitTextToSize('• ' + content, contentWidth - 5);
        wrappedLines.forEach(l => {
          if (y > pageHeight - marginY) { doc.addPage(); y = marginY; }
          doc.text(l, marginX + 3, y);
          y += 5;
        });

      } else {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const wrappedLines = doc.splitTextToSize(content, contentWidth);
        wrappedLines.forEach(l => {
          if (y > pageHeight - marginY) { doc.addPage(); y = marginY; }
          doc.text(l, marginX, y);
          y += 5;
        });
      }
    }

    const filename = buildCVFilename(cvText, cvDataCache?.job_title, cvDataCache?.company, lang, 'pdf');
    doc.save(filename);

  } catch (err) {
    console.error('PDF generation error:', err);
    showMobileFallback();
    // Try triggering mobile fallback
    alert('Tidak bisa generate PDF. Gunakan tombol salin teks di bawah.');
  }
}

// ---- UI Helpers ----

function showState(id) {
  ['waiting-payment', 'session-error', 'generating-cv', 'download-ready'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
}

function showSessionError(title, message, retryable = false) {
  showState('session-error');
  document.getElementById('error-title').textContent = title;
  document.getElementById('session-error-msg').textContent = message;
  const retryBtn = document.getElementById('error-retry-btn');
  const restartBtn = document.getElementById('error-restart-btn');
  if (retryBtn) retryBtn.classList.toggle('hidden', !retryable);
  if (restartBtn) restartBtn.classList.toggle('hidden', retryable);
}

function retryGeneration() {
  if (!sessionIdCache) { window.location.reload(); return; }
  fetchAndGenerateCV(sessionIdCache);
}

function setProgress(pct) {
  const bar = document.getElementById('progress-bar');
  if (bar) bar.style.width = pct + '%';
}

function setGeneratingText(text) {
  const el = document.getElementById('generating-text');
  if (el) el.textContent = text;
}

function showCreditsDashboard(creditsRemaining, totalCredits, tier) {
  showState('download-ready');
  // No previous CV — hide the download grid
  const grid = document.getElementById('download-grid');
  if (grid) grid.classList.add('hidden');
  // Also hide the success header since nothing was generated yet
  const successHeader = document.querySelector('#download-ready > .card:nth-child(2) > div:first-child');
  if (successHeader) successHeader.classList.add('hidden');
  // Show multi-credit section
  const multiSection = document.getElementById('multi-credit-section');
  if (multiSection) {
    const creditsEl = document.getElementById('credits-remaining-count');
    if (creditsEl) creditsEl.textContent = creditsRemaining;
    const totalEl = document.getElementById('credits-total-count');
    if (totalEl) totalEl.textContent = totalCredits;
    multiSection.classList.remove('hidden');
  }
  // Cache tier for generateForNewJob
  cvDataCache = { cv_id: null, cv_en: null, tier: tier || 'single' };
}

function showDownloadReady(cvId, cvEn, tier, isBilingual, creditsRemaining) {
  showState('download-ready');

  // Show EN section for bilingual tiers — always reveal so the user knows it's included
  if (isBilingual) {
    const enSection = document.getElementById('en-section');
    if (enSection) enSection.classList.remove('hidden');
    // If EN text is missing despite bilingual tier, show a degraded state on the buttons
    if (!cvEn) {
      enSection && enSection.querySelectorAll('.btn-download').forEach(btn => {
        btn.disabled = true;
        btn.title = 'CV Bahasa Inggris gagal dibuat. Coba generate ulang.';
      });
    }
  }

  // Set plain text for mobile fallback
  document.getElementById('cv-text-id').value = cvId || '';
  if (cvEn) {
    document.getElementById('cv-text-en').value = cvEn;
  }

  // Show multi-credit UI when credits remain
  const multiSection = document.getElementById('multi-credit-section');
  const creditsEl = document.getElementById('credits-remaining-count');
  if (multiSection && creditsRemaining > 0) {
    if (creditsEl) creditsEl.textContent = creditsRemaining;
    const totalEl = document.getElementById('credits-total-count');
    if (totalEl) totalEl.textContent = cvDataCache?.total_credits ?? (creditsRemaining + 1);
    multiSection.classList.remove('hidden');
  }
  // Show upgrade nudge when all credits are used
  if (creditsRemaining <= 0) {
    const upgradeEl = document.getElementById('upgrade-nudge');
    if (upgradeEl) upgradeEl.classList.remove('hidden');
  }

  // Detect if mobile (for fallback hint)
  const isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(navigator.userAgent);
  if (isMobile) {
    document.getElementById('mobile-fallback').classList.remove('mobile-download-show');
    // Show after small delay so DOCX/PDF buttons appear first
    setTimeout(() => {
      document.getElementById('mobile-fallback').classList.add('mobile-download-show');
      document.getElementById('mobile-fallback').classList.remove('hidden');
      if (isBilingual) {
        document.getElementById('en-fallback').classList.remove('hidden');
      }
    }, 2000);
  }
}

// ---- Multi-credit: generate for a new job ----

async function generateForNewJob() {
  const textarea = document.getElementById('new-job-desc');
  const btn = document.getElementById('new-job-btn');
  if (!textarea || !btn || !sessionIdCache) return;

  const newJobDesc = textarea.value.trim();
  if (!newJobDesc) {
    textarea.focus();
    return;
  }
  if (newJobDesc.length > 5000) {
    alert('Job description terlalu panjang (maks 5.000 karakter).');
    return;
  }

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Menghubungi server...';

  try {
    // Step 1: call /get-session to unlock 'generating' status
    const secretHeaders = sessionSecretCache ? { 'X-Session-Secret': sessionSecretCache } : {};
    const gsRes = await fetch(`${WORKER_URL}/get-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...secretHeaders },
      body: JSON.stringify({ session_id: sessionIdCache })
    });

    if (!gsRes.ok) {
      const err = await gsRes.json().catch(() => ({}));
      throw new Error(err.message || `Server error: ${gsRes.status}`);
    }

    const { tier } = await gsRes.json();

    // Step 2: hide multi-credit section, show generating state
    document.getElementById('multi-credit-section').classList.add('hidden');
    showState('generating-cv');
    setProgress(10);
    setGeneratingText('AI sedang menulis CV untuk loker baru...');

    // Step 3: call /generate with new job_desc
    await generateCVContent(sessionIdCache, tier, newJobDesc);

  } catch (err) {
    btn.disabled = false;
    btn.textContent = originalText;
    alert(err.message || 'Terjadi kesalahan. Coba lagi.');
  }
}

function showMobileFallback() {
  if (!cvDataCache) return;
  document.getElementById('mobile-fallback').classList.remove('hidden');
  document.getElementById('cv-text-id').value = cvDataCache.cv_id || '';
  if (cvDataCache.cv_en) {
    document.getElementById('cv-text-en').value = cvDataCache.cv_en;
    document.getElementById('en-fallback').classList.remove('hidden');
  }
}

function copyText(textareaId) {
  const el = document.getElementById(textareaId);
  if (!el) return;
  el.select();
  document.execCommand('copy');
  // Brief visual feedback
  const btn = el.nextElementSibling;
  if (btn) {
    const original = btn.textContent;
    btn.textContent = 'Tersalin!';
    setTimeout(() => btn.textContent = original, 2000);
  }
}
