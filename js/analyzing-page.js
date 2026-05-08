// Read pending data from sessionStorage
// gaslamar_jd_pending is HTML-entity-escaped on write; unescape before use.
function _unescapeHtml(text) {
  const map = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'" };
  return text.replace(/&amp;|&lt;|&gt;|&quot;|&#039;/g, m => map[m]);
}
const cvData    = sessionStorage.getItem('gaslamar_cv_pending');
const jobDesc   = _unescapeHtml(sessionStorage.getItem('gaslamar_jd_pending') || '');
const filename  = sessionStorage.getItem('gaslamar_filename') || 'CV Kamu';

// Redirect if no pending data (direct navigation or page refresh after completion)
if (!cvData || !jobDesc) {
  // If a fresh analysis result already exists, send them to hasil.html
  const existingScore = sessionStorage.getItem('gaslamar_scoring');
  const analyzeTime = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0');
  const isFresh = existingScore && analyzeTime && (Date.now() - analyzeTime) < 7200000;
  window.location.replace(isFresh ? 'hasil.html' : 'upload.html');
}

// Show filename
document.getElementById('filenameDisplay').textContent = filename;

// Animation state
let completedStep = 0;
const totalSteps = 4;
let startTime = Date.now();
const estimatedMs = 35000;
// Maximum time we wait for the /analyze response (PDF needs 3 sequential Claude calls)
const FETCH_TIMEOUT_MS = 55000;
let analysisComplete = false;
let abortController = new AbortController();
// Distinguish user-initiated cancel from our timeout abort
let isTimedOut = false;
let analysisTimeoutId = null;

const trustMessages = [
  '🔒 CV tidak disimpan — aman',
  '🤖 Analisis berbasis pola HR & ATS',
  '🎯 Hasil spesifik untuk job ini',
  '⚡ Rata-rata selesai dalam 30 detik'
];
let trustIndex = 0;

function setStepDone(n) {
  const icon = document.getElementById('step' + n + 'Icon');
  if (!icon) return;
  icon.textContent = '✓';
  icon.className = 'step-status';
  icon.style.color = '#10B981';
}

function setStepActive(n) {
  const icon = document.getElementById('step' + n + 'Icon');
  if (!icon) return;
  icon.textContent = '⟳';
  icon.className = 'step-status spinning';
  icon.style.color = '#0F172A';
}

function advanceAnimation() {
  if (completedStep > 0) setStepDone(completedStep);
  completedStep++;
  if (completedStep <= totalSteps) {
    setStepActive(completedStep);
    const pct = Math.round((completedStep / (totalSteps + 1)) * 90);
    document.getElementById('progressFill').style.width = pct + '%';
  }
}

function finishAnimation() {
  for (let i = 1; i <= totalSteps; i++) setStepDone(i);
  document.getElementById('progressFill').style.width = '100%';
  document.getElementById('timerText').textContent = '✅ Analisis selesai! Mengarahkan ke hasil...';
}

// Step animation — track IDs so retryAnalysis() can cancel pending timers
// M19: Guard against 0 interval if estimatedMs is very small.
const stepInterval = Math.max(100, Math.floor(estimatedMs / (totalSteps + 1)));
let stepTimeouts = [];

function scheduleSteps() {
  stepTimeouts.forEach(id => clearTimeout(id));
  stepTimeouts = [];
  advanceAnimation(); // step 1 active immediately
  for (let i = 1; i < totalSteps; i++) {
    const id = setTimeout(() => { if (!analysisComplete) advanceAnimation(); }, i * stepInterval);
    stepTimeouts.push(id);
  }
}

scheduleSteps();

// Countdown timer — use `let` so retryAnalysis() can reassign
let timerInterval = setInterval(() => {
  const elapsed = Date.now() - startTime;
  const remaining = Math.max(0, Math.ceil((estimatedMs - elapsed) / 1000));
  if (!analysisComplete) {
    if (remaining > 0) {
      document.getElementById('timerText').textContent = '⏱️ Estimasi sisa: ~' + remaining + ' detik';
    } else {
      // After the estimate, show an honest "still processing" message for PDF files
      const extraSecs = Math.round((elapsed - estimatedMs) / 1000);
      document.getElementById('timerText').textContent = extraSecs >= 15
        ? '⏱️ PDF memerlukan waktu lebih lama — hampir selesai...'
        : '⏱️ Hampir selesai...';
    }
  }
}, 1000);

// Rotate trust messages — use `let` so retryAnalysis() can reassign
let trustInterval = setInterval(() => {
  trustIndex = (trustIndex + 1) % trustMessages.length;
  const el = document.getElementById('trustMessage');
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = trustMessages[trustIndex];
    el.style.opacity = '1';
  }, 150);
}, 5000);

// Make actual API call
async function runAnalysis() {
  if (window.Analytics) Analytics.track('analysis_started', {
    has_jd: !!(jobDesc && jobDesc.trim().length >= 50),
  });

  // Abort the fetch after FETCH_TIMEOUT_MS — prevents the page from hanging
  // indefinitely when the backend (3 sequential Claude calls for PDF) takes >35s.
  isTimedOut = false;
  analysisTimeoutId = setTimeout(() => {
    isTimedOut = true;
    abortController.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(WORKER_URL + '/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cv: cvData, job_desc: jobDesc }),
      signal: abortController.signal
    });

    clearTimeout(analysisTimeoutId);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err.message || '';
      // Surface rate limit with retry guidance
      if (response.status === 429) {
        const retryAfter = err.retryAfter || 60;
        throw new Error(`Terlalu banyak permintaan. Coba lagi dalam ${retryAfter} detik.`);
      }
      throw new Error(msg || 'Server error: ' + response.status);
    }

    const result = await response.json();

    // Store results — strip cv_text_key from scoring blob (stored separately as gaslamar_cv_key)
    const { cv_text_key: _cvKey, ...scoringOnly } = result;
    sessionStorage.setItem('gaslamar_scoring', JSON.stringify(scoringOnly));
    sessionStorage.setItem('gaslamar_cv_key', _cvKey || '');
    sessionStorage.setItem('gaslamar_analyze_time', String(Date.now()));
    if (window.Analytics) Analytics.track('analysis_completed', {
      score: result.skor || null,
      confidence: result.konfidensitas || null,
      time_ms: (() => { const t = sessionStorage.getItem('gaslamar_upload_start'); return t ? Date.now() - parseInt(t, 10) : undefined; })(),
    });

    // Clear pending data — analysis succeeded, draft no longer needed
    sessionStorage.removeItem('gaslamar_cv_pending');
    sessionStorage.removeItem('gaslamar_jd_pending');
    sessionStorage.removeItem('gaslamar_filename');
    sessionStorage.removeItem('gaslamar_jd_draft');

    // Finish animation then redirect
    analysisComplete = true;
    clearInterval(timerInterval);
    clearInterval(trustInterval);
    finishAnimation();

    setTimeout(() => { window.location.replace('hasil.html'); }, 800);

  } catch (err) {
    clearTimeout(analysisTimeoutId);
    clearInterval(timerInterval);
    clearInterval(trustInterval);

    // User clicked "← Ubah CV atau job" — abort is expected, don't show error
    if (err.name === 'AbortError' && !isTimedOut) return;

    if (window.Analytics) Analytics.trackError('analysis_api', {
      error_message: (err.message || '').slice(0, 150),
      is_timeout: isTimedOut,
      is_network: err.name === 'TypeError',
    });

    let msg = err.message || 'Terjadi kesalahan. Coba lagi.';
    if (err.name === 'TypeError') {
      msg = 'Tidak bisa terhubung ke server. Periksa koneksi internet kamu, lalu coba lagi.';
    } else if (isTimedOut || err.name === 'AbortError') {
      msg = 'Analisis memakan waktu terlalu lama. Coba lagi — PDF kadang membutuhkan waktu ekstra.';
    }

    document.getElementById('analyze-error-msg').textContent = msg;
    document.getElementById('analyze-error').style.display = 'block';
    document.getElementById('analyzeCard').style.display = 'none';
  }
}

function retryAnalysis() {
  document.getElementById('analyze-error').style.display = 'none';
  document.getElementById('analyzeCard').style.display = '';
  completedStep = 0;
  startTime = Date.now();
  analysisComplete = false;
  isTimedOut = false;
  abortController = new AbortController();

  // Reset step icons
  for (let i = 1; i <= totalSteps; i++) {
    const icon = document.getElementById('step' + i + 'Icon');
    if (icon) { icon.textContent = '○'; icon.className = 'step-status'; icon.style.color = ''; }
  }
  document.getElementById('progressFill').style.width = '0%';

  // Restart intervals that were cleared during the error path
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, Math.ceil((estimatedMs - elapsed) / 1000));
    if (!analysisComplete) {
      if (remaining > 0) {
        document.getElementById('timerText').textContent = '⏱️ Estimasi sisa: ~' + remaining + ' detik';
      } else {
        const extraSecs = Math.round((elapsed - estimatedMs) / 1000);
        document.getElementById('timerText').textContent = extraSecs >= 15
          ? '⏱️ PDF memerlukan waktu lebih lama — hampir selesai...'
          : '⏱️ Hampir selesai...';
      }
    }
  }, 1000);

  trustInterval = setInterval(() => {
    trustIndex = (trustIndex + 1) % trustMessages.length;
    const el = document.getElementById('trustMessage');
    el.style.opacity = '0';
    setTimeout(() => {
      el.textContent = trustMessages[trustIndex];
      el.style.opacity = '1';
    }, 150);
  }, 5000);

  scheduleSteps();
  runAnalysis();
}

// Edit back link
document.getElementById('editBackLink').addEventListener('click', (e) => {
  e.preventDefault();
  if (confirm('Batalkan analisis dan kembali ke halaman upload? Data tidak akan tersimpan.')) {
    clearTimeout(analysisTimeoutId);
    abortController.abort(); // user-initiated — isTimedOut stays false → catch returns silently
    clearInterval(timerInterval);
    clearInterval(trustInterval);
    stepTimeouts.forEach(id => clearTimeout(id));
    sessionStorage.removeItem('gaslamar_cv_pending');
    sessionStorage.removeItem('gaslamar_jd_pending');
    sessionStorage.removeItem('gaslamar_filename');
    window.location.href = 'upload.html';
  }
});

// Retry button
document.getElementById('retry-analysis-btn').addEventListener('click', retryAnalysis);

// Start analysis
runAnalysis();
