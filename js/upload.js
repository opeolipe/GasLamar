/**
 * upload.js — GasLamar
 * Handles: file reading (PDF/DOCX), job description input, send to Worker /analyze
 * Requires: js/config.js (defines WORKER_URL)
 */

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_JD_CHARS = 5000;
const MIN_CV_TEXT_LENGTH = 100;
const MIN_JD_LENGTH = 100;

let selectedFile = null;
let cvText = '';

// ---- Drag & Drop ----

function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.add('drop-zone-active');
}

function handleDragLeave(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drop-zone-active');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drop-zone-active');
  const file = e.dataTransfer.files[0];
  if (file) {
    if (window.Analytics) Analytics.track('file_selected', { method: 'drag_drop' });
    processFile(file);
  }
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) {
    if (window.Analytics) Analytics.track('file_selected', { method: 'input' });
    processFile(file);
  }
}

function removeFile() {
  selectedFile = null;
  cvText = '';
  document.getElementById('drop-idle').classList.remove('hidden');
  document.getElementById('drop-preview').classList.add('hidden');
  document.getElementById('cv-file').value = '';
  hideError('file-error');
  syncSubmitBtn();
}

function processFile(file) {
  // Clear any stale data from a previous flow before starting fresh
  ['gaslamar_scoring', 'gaslamar_cv_key', 'gaslamar_cv_pending',
   'gaslamar_jd_pending', 'gaslamar_filename', 'gaslamar_tier',
   'gaslamar_email', 'gaslamar_analyze_time',
   'gaslamar_cv_draft', 'gaslamar_filename_draft',
  ].forEach(k => sessionStorage.removeItem(k));

  hideError('file-error');
  hideError('cv-text-warning');

  // Validate file type by extension + MIME
  const validTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ];
  const validExts = ['.pdf', '.docx', '.txt'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();

  if (!validExts.includes(ext) && !validTypes.includes(file.type)) {
    // Give specific guidance for common unsupported formats
    if (ext === '.doc') {
      showError('file-error', 'Format .doc belum didukung. Buka di Word → Save As → .docx atau PDF, lalu upload lagi.');
    } else if (ext === '.pages') {
      showError('file-error', 'Format .pages belum didukung. Export sebagai PDF dari Pages, lalu upload lagi.');
    } else if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      showError('file-error', 'File gambar tidak didukung. Upload CV dalam format PDF, DOCX, atau TXT.');
    } else {
      showError('file-error', 'Format tidak didukung. Upload CV dalam format PDF, DOCX, atau TXT (maks 5MB).');
    }
    if (window.Analytics) Analytics.track('file_validation_failed', { reason: 'wrong_type', file_ext: ext, file_size_kb: Math.round(file.size / 1024) });
    return;
  }

  // Validate size
  if (file.size > MAX_FILE_SIZE) {
    showError('file-error', `Ukuran file terlalu besar (${(file.size / 1024 / 1024).toFixed(1)}MB). Maksimal 5MB.`);
    if (window.Analytics) Analytics.track('file_validation_failed', { reason: 'too_large', file_ext: ext, file_size_kb: Math.round(file.size / 1024) });
    return;
  }

  selectedFile = file;
  sessionStorage.setItem('gaslamar_upload_start', String(Date.now()));
  showFilePreview(file);
  syncSubmitBtn();
  extractTextFromFile(file);
}

function showFilePreview(file) {
  document.getElementById('drop-idle').classList.add('hidden');
  document.getElementById('drop-preview').classList.remove('hidden');
  document.getElementById('file-name').textContent = file.name;
  document.getElementById('file-size').textContent = formatFileSize(file.size);
  // Mark step 1 complete, activate step 2
  const s1 = document.getElementById('step-1');
  const s2 = document.getElementById('step-2');
  if (s1) { s1.classList.remove('active'); s1.classList.add('completed'); }
  if (s2) s2.classList.add('active');
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ---- Text Extraction ----

async function extractTextFromFile(file) {
  const ext = '.' + file.name.split('.').pop().toLowerCase();

  try {
    if (ext === '.pdf') {
      cvText = await extractFromPDF(file);
    } else if (ext === '.docx') {
      cvText = await extractFromDOCX(file);
    } else if (ext === '.txt') {
      cvText = await extractFromTXT(file);
    }

    // Validate minimum text length
    if (cvText.trim().length < MIN_CV_TEXT_LENGTH) {
      document.getElementById('cv-text-warning').classList.remove('hidden');
      cvText = '';
    } else {
      // Persist CV text draft so the user can navigate away and return without losing their file.
      // Draft is cleared on new file selection (processFile) and superseded by gaslamar_cv_pending
      // after successful analysis.
      try {
        sessionStorage.setItem('gaslamar_cv_draft', cvText);
        sessionStorage.setItem('gaslamar_filename_draft', file.name);
      } catch (_) { /* sessionStorage full or blocked — non-fatal */ }
    }
  } catch (err) {
    showError('file-error', 'Gagal membaca file. Pastikan file tidak rusak dan coba lagi.');
    cvText = '';
  }
}

async function extractFromPDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        // Validate PDF magic bytes: %PDF (0x25 0x50 0x44 0x46)
        const bytes = new Uint8Array(e.target.result.slice(0, 4));
        if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
          reject(new Error('Bukan file PDF yang valid'));
          return;
        }

        // Use pdf.js if available, otherwise send raw bytes to worker
        // For now we'll send the binary to the worker for server-side extraction
        const base64 = arrayBufferToBase64(e.target.result);
        resolve(JSON.stringify({ type: 'pdf', data: base64 }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsArrayBuffer(file);
  });
}

async function extractFromDOCX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        // Validate DOCX magic bytes: PK (0x50 0x4B) — ZIP format
        const bytes = new Uint8Array(e.target.result.slice(0, 2));
        if (bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
          reject(new Error('Bukan file DOCX yang valid'));
          return;
        }

        const base64 = arrayBufferToBase64(e.target.result);
        resolve(JSON.stringify({ type: 'docx', data: base64 }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsArrayBuffer(file);
  });
}

async function extractFromTXT(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(JSON.stringify({ type: 'txt', data: e.target.result }));
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsText(file, 'UTF-8');
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ---- Submit Button State ----
// Single source of truth: disabled when no file, JD too short, or JD over limit.

function syncSubmitBtn() {
  const btn = document.getElementById('submit-btn');
  const hint = document.getElementById('submit-hint');
  if (!btn) return;
  const hasFile = !!selectedFile;
  const jdTrimLen = document.getElementById('job-desc').value.trim().length;
  const jdTooShort = jdTrimLen < MIN_JD_LENGTH;
  const jdTooLong  = document.getElementById('job-desc').value.length > MAX_JD_CHARS;

  btn.disabled = !hasFile || jdTooShort || jdTooLong;

  if (hint) {
    if (!hasFile) {
      hint.textContent = '📄 Upload CV kamu dulu sebelum analisis';
      hint.style.display = '';
    } else if (jdTooShort) {
      hint.textContent = '✍️ Isi job description dulu (min. 100 karakter)';
      hint.style.display = '';
    } else {
      hint.style.display = 'none';
    }
  }
}

// ---- Character Counter ----

function updateCharCount() {
  const jd = document.getElementById('job-desc');

  // Enforce hard cap — paste can bypass HTML maxlength on some browsers
  if (jd.value.length > MAX_JD_CHARS) {
    jd.value = jd.value.slice(0, MAX_JD_CHARS);
  }

  const count = jd.value.length;
  document.getElementById('char-count').textContent = count.toLocaleString('id-ID');

  // Colour the counter: amber when approaching cap, red when at cap
  const counterEl = document.querySelector('.char-counter');
  if (counterEl) {
    counterEl.classList.toggle('near-limit', count > 4500 && count < MAX_JD_CHARS);
    counterEl.classList.toggle('at-limit',   count >= MAX_JD_CHARS);
  }

  const warning = document.getElementById('char-warning');
  if (count >= MAX_JD_CHARS) {
    warning.textContent = 'Batas karakter tercapai';
    warning.classList.remove('hidden');
    // At exactly the limit (5000 chars) the submission is still valid — don't show
    // a "too long" error that contradicts the enabled submit button. The counter
    // warning above is sufficient feedback that no more characters can be added.
    hideError('jd-error');
  } else if (count > 4500) {
    warning.textContent = 'Mendekati batas karakter';
    warning.classList.remove('hidden');
    hideError('jd-error'); // well past MIN_JD_LENGTH — no "too short" needed
  } else {
    warning.classList.add('hidden');
    const trimLen = jd.value.trim().length;
    if (trimLen > 0 && trimLen < MIN_JD_LENGTH) {
      // Show "too short" without the button shake — direct DOM update only
      const jdErrEl = document.getElementById('jd-error');
      if (jdErrEl) {
        jdErrEl.textContent = `Job description terlalu pendek. Tulis minimal ${MIN_JD_LENGTH} karakter (bagian Requirements dan Responsibilities) untuk analisis yang akurat.`;
        jdErrEl.classList.remove('hidden');
      }
    } else {
      hideError('jd-error');
    }
  }

  syncSubmitBtn();
}

// ---- Form Submit ----

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  // Submission guard — reject if the raw value is still over the limit
  // (devtools bypass or race condition on programmatic assignment).
  const rawJd = document.getElementById('job-desc').value;
  if (rawJd.length > MAX_JD_CHARS) {
    showError('jd-error', `Job description terlalu panjang. Maksimal ${MAX_JD_CHARS.toLocaleString('id-ID')} karakter.`);
    return;
  }
  const jobDesc = rawJd.trim().slice(0, MAX_JD_CHARS);

  // Validate inputs
  if (!selectedFile || !cvText) {
    showError('file-error', 'Mohon upload CV kamu terlebih dahulu.');
    return;
  }

  if (cvText === '') {
    document.getElementById('cv-text-warning').classList.remove('hidden');
    return;
  }

  if (jobDesc.length < MIN_JD_LENGTH) {
    showError('jd-error', `Job description terlalu pendek. Tulis minimal ${MIN_JD_LENGTH} karakter (bagian Requirements dan Responsibilities) untuk analisis yang akurat.`);
    return;
  }

  // Store CV data and redirect to analyzing page (which makes the API call)
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;

  sessionStorage.setItem('gaslamar_cv_pending', cvText);
  sessionStorage.setItem('gaslamar_jd_pending', jobDesc);
  sessionStorage.setItem('gaslamar_filename', selectedFile ? selectedFile.name : 'CV');
  sessionStorage.setItem('gaslamar_had_jd', jobDesc.length >= 50 ? '1' : '0');
  // Note: gaslamar_jd_draft is cleared by analyzing-page.js on successful analysis,
  // not here — so the draft survives if the analysis fails and the user returns.

  if (window.Analytics) Analytics.track('upload_submitted', {
    file_ext: '.' + selectedFile.name.split('.').pop().toLowerCase(),
    jd_length: jobDesc.length,
  });

  window.location.href = 'analyzing.html';
});

async function analyzeCV(cvData, jobDesc) {
  setLoadingText('AI sedang menganalisis CV kamu...');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch(`${WORKER_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cv: cvData, job_desc: jobDesc }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Server error: ${response.status}`);
    }

    const result = await response.json();

    // Save scoring results and server-side key for hasil.html
    // Store cv_text_key (not raw CV bytes) so payment.js can reference
    // the server-side KV entry — no sensitive file data in sessionStorage
    sessionStorage.setItem('gaslamar_scoring', JSON.stringify(result));
    sessionStorage.setItem('gaslamar_cv_key', result.cv_text_key || '');
    sessionStorage.removeItem('gaslamar_cv'); // clear any stale raw CV data

    // Redirect to scoring page
    setLoadingText('Menyiapkan hasil analisis...');
    finishProgress();
    window.location.href = 'hasil.html';

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Analisis memakan waktu terlalu lama. Coba lagi.');
    }
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      throw new Error('Tidak bisa terhubung ke server. Periksa koneksi internet kamu, lalu coba lagi.');
    }
    throw err;
  }
}

function setLoadingText(text) {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = text;
}

// ---- Progress Bar ----
let _progressTimer = null;

function setProgress(pct) {
  const bar = document.getElementById('progress-bar');
  const label = document.getElementById('progress-pct');
  if (bar) bar.style.width = pct + '%';
  if (label) label.textContent = pct;
}

function startProgress() {
  setProgress(5);
  // Simulate progress: slow crawl to 85%, then hold until done
  const steps = [
    { pct: 25, delay: 2000 },
    { pct: 45, delay: 8000 },
    { pct: 65, delay: 15000 },
    { pct: 80, delay: 25000 },
    { pct: 85, delay: 35000 },
  ];
  steps.forEach(({ pct, delay }) => {
    const t = setTimeout(() => setProgress(pct), delay);
    if (!_progressTimer) _progressTimer = [];
    _progressTimer.push(t);
  });
}

function finishProgress() {
  if (_progressTimer) { _progressTimer.forEach(clearTimeout); _progressTimer = null; }
  setProgress(100);
}

// ---- Helpers ----

function showError(id, message) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = message;
    el.classList.remove('hidden');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  // Visual feedback on submit button: shake + red ring
  const btn = document.getElementById('submit-btn');
  if (btn) {
    btn.classList.remove('btn-error'); // reset to re-trigger animation
    void btn.offsetWidth; // force reflow
    btn.classList.add('btn-error');
  }
}

function hideError(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
  // Remove error ring only when no validation errors are visible
  const anyVisible = ['file-error','jd-error'].some(eid => {
    const e = document.getElementById(eid);
    return e && !e.classList.contains('hidden');
  });
  if (!anyVisible) {
    const btn = document.getElementById('submit-btn');
    if (btn) btn.classList.remove('btn-error');
  }
}

// ---- Init: restore tier, JD draft, and CV state ----

(function init() {
  // Override textarea value setter so MAX_JD_CHARS is enforced even for
  // programmatic assignments (element.value = '...') — those bypass oninput/paste.
  const jdEl = document.getElementById('job-desc');
  const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  Object.defineProperty(jdEl, 'value', {
    get() { return proto.get.call(this); },
    set(v) {
      const capped = (typeof v === 'string' && v.length > MAX_JD_CHARS) ? v.slice(0, MAX_JD_CHARS) : v;
      proto.set.call(this, capped);
      updateCharCount();
      // Save draft on programmatic assignments too (e.g. staging test panel auto-fill),
      // not just on user keystrokes. The input event listener covers manual typing;
      // this setter covers jdEl.value = '...' calls that bypass the input event.
      sessionStorage.setItem('gaslamar_jd_draft', proto.get.call(this));
    },
    configurable: false,
  });

  // Valid tier values — must match TIER_CREDITS/TIER_PRICES in the Worker
  const VALID_TIERS = ['coba', 'single', '3pack', 'jobhunt'];
  const params = new URLSearchParams(location.search);
  let tierParam = (params.get('tier') || '').toLowerCase().trim();

  if (tierParam && !VALID_TIERS.includes(tierParam)) {
    // Invalid tier — warn the user, fall back to 'single', and clean the URL
    console.warn(`[GasLamar] Invalid tier param: "${tierParam}". Falling back to "single".`);
    const warningEl = document.getElementById('tier-warning');
    if (warningEl) {
      warningEl.textContent = 'Paket tidak dikenal. Menggunakan paket Single sebagai default.';
      warningEl.classList.remove('hidden');
    }
    params.delete('tier');
    const cleanUrl = params.toString()
      ? `${location.pathname}?${params.toString()}`
      : location.pathname;
    history.replaceState(null, '', cleanUrl);
    tierParam = 'single';
  }

  if (VALID_TIERS.includes(tierParam)) {
    sessionStorage.setItem('gaslamar_tier', tierParam);
  }

  // Restore JD draft
  const savedJd = sessionStorage.getItem('gaslamar_jd_draft');
  if (savedJd) {
    document.getElementById('job-desc').value = savedJd;
    updateCharCount();
  }

  // Restore CV state: prefer post-analysis data (gaslamar_cv_pending), fall back to
  // pre-analysis draft (gaslamar_cv_draft) saved right after file extraction.
  const pendingCv   = sessionStorage.getItem('gaslamar_cv_pending');
  const pendingName = sessionStorage.getItem('gaslamar_filename');
  const draftCv     = sessionStorage.getItem('gaslamar_cv_draft');
  const draftName   = sessionStorage.getItem('gaslamar_filename_draft');
  const restoreCv   = pendingCv || draftCv;
  const restoreName = (pendingCv ? pendingName : draftName) || null;

  if (restoreCv && restoreName) {
    cvText = restoreCv;
    selectedFile = { name: restoreName }; // truthy placeholder for form validation
    document.getElementById('drop-idle').classList.add('hidden');
    document.getElementById('drop-preview').classList.remove('hidden');
    document.getElementById('file-name').textContent = restoreName;
    document.getElementById('file-size').textContent = pendingCv ? '(sudah diproses)' : '(draft dipulihkan)';
  }

  syncSubmitBtn();
})();

// Save JD draft on every keystroke
document.getElementById('job-desc').addEventListener('input', () => {
  sessionStorage.setItem('gaslamar_jd_draft', document.getElementById('job-desc').value);
});

// Paste fires BEFORE the value is updated — use requestAnimationFrame so
// updateCharCount reads the final value (and enforces the hard cap).
document.getElementById('job-desc').addEventListener('paste', () => {
  requestAnimationFrame(updateCharCount);
});

// Re-sync submit button when page is restored from BFcache (back-navigation or tab switch).
// Without this, the button stays disabled if the user navigated away mid-submit.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) syncSubmitBtn();
});

// ---- Staging test hook ----
// Called by staging-cvs.js to inject pre-extracted CV text without going
// through FileReader (avoids async timing issues with the change event).
window.injectCVForTesting = function (cvTextJson, file) {
  cvText = cvTextJson;
  selectedFile = file;
  showFilePreview(file);
  syncSubmitBtn();
  hideError('file-error');
  const cvWarn = document.getElementById('cv-text-warning');
  if (cvWarn) cvWarn.classList.add('hidden');
};
