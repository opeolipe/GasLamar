/**
 * download.js — GasLamar
 * Handles: session polling, CV generation via Worker, DOCX + PDF generation client-side
 * Requires: js/config.js (defines WORKER_URL)
 */

const POLL_INTERVAL = 3000;  // 3 seconds
const MAX_POLLS = 10;

let pollCount = 0;
let pollTimer = null;
let cvDataCache = null; // { cv_id: string, cv_en: string, tier: string }
let sessionIdCache = null; // retained for multi-credit re-use

// ---- Init ----

(function init() {
  // Get session from URL or localStorage fallback
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session') || localStorage.getItem('gaslamar_session');

  if (!sessionId) {
    showSessionError('Sesi tidak ditemukan', 'Link download tidak valid. Coba lagi dari awal.');
    return;
  }

  sessionIdCache = sessionId;
  // Start polling for payment confirmation
  showState('waiting-payment');
  startPolling(sessionId);
})();

// ---- Polling ----

function startPolling(sessionId) {
  pollCount = 0;
  poll(sessionId);
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

    if (res.status === 404) {
      showSessionError('Sesi Kedaluwarsa', 'Sesi kamu sudah kedaluwarsa. Mulai ulang dari awal.');
      return;
    }

    if (!res.ok) {
      scheduleNextPoll(sessionId);
      return;
    }

    const { status } = await res.json();

    if (status === 'paid' || status === 'generating') {
      // Payment confirmed! Fetch CV data and generate
      clearTimeout(pollTimer);
      await fetchAndGenerateCV(sessionId);
    } else if (status === 'pending') {
      if (pollCount >= MAX_POLLS) {
        // Stopped polling — show manual check buttons
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

function updatePollUI() {
  const el = document.getElementById('poll-count-text');
  if (el) {
    el.textContent = `Memeriksa status... (${pollCount}/${MAX_POLLS})`;
  }
}

// ---- Fetch Session & Generate CV ----

async function fetchAndGenerateCV(sessionId) {
  showState('generating-cv');
  setProgress(10);
  setGeneratingText('Mengambil data CV...');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(`${WORKER_URL}/get-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (res.status === 403) {
      showSessionError('Akses Ditolak', 'Pembayaran belum dikonfirmasi atau sesi tidak valid.');
      return;
    }

    if (res.status === 404) {
      showSessionError('Sesi Kedaluwarsa', 'Sesi kamu sudah kedaluwarsa. Mulai ulang dari awal.');
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

    const res = await fetch(`${WORKER_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Gagal generate CV: ${res.status}`);
    }

    setProgress(75);
    setGeneratingText('Menyiapkan file download...');

    const { cv_id, cv_en, credits_remaining } = await res.json();

    // Cache for retries
    cvDataCache = { cv_id, cv_en, tier };

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
      const langLabel = lang === 'id' ? 'ID' : 'EN';
      const candidateName = extractCandidateName(cvText);
      const filename = candidateName ? `CV-${candidateName}-${langLabel}-GasLamar.docx` : `CV-${langLabel}-GasLamar.docx`;
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

    const langLabel = lang === 'id' ? 'ID' : 'EN';
    const candidateName = extractCandidateName(cvText);
    const filename = candidateName ? `CV-${candidateName}-${langLabel}-GasLamar.pdf` : `CV-${langLabel}-GasLamar.pdf`;
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

function showSessionError(title, message) {
  showState('session-error');
  document.getElementById('error-title').textContent = title;
  document.getElementById('session-error-msg').textContent = message;
}

function setProgress(pct) {
  const bar = document.getElementById('progress-bar');
  if (bar) bar.style.width = pct + '%';
}

function setGeneratingText(text) {
  const el = document.getElementById('generating-text');
  if (el) el.textContent = text;
}

function showDownloadReady(cvId, cvEn, tier, isBilingual, creditsRemaining) {
  showState('download-ready');

  // Show EN section for bilingual tiers
  if (isBilingual && cvEn) {
    document.getElementById('en-section').classList.remove('hidden');
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
    multiSection.classList.remove('hidden');
  }

  // Detect if mobile (for fallback hint)
  const isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(navigator.userAgent);
  if (isMobile) {
    document.getElementById('mobile-fallback').classList.remove('mobile-download-show');
    // Show after small delay so DOCX/PDF buttons appear first
    setTimeout(() => {
      document.getElementById('mobile-fallback').classList.add('mobile-download-show');
      document.getElementById('mobile-fallback').classList.remove('hidden');
      if (isBilingual && cvEn) {
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
    const gsRes = await fetch(`${WORKER_URL}/get-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
