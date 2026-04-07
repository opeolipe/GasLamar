// Read pending data from sessionStorage
const cvData    = sessionStorage.getItem('gaslamar_cv_pending');
const jobDesc   = sessionStorage.getItem('gaslamar_jd_pending');
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
let analysisComplete = false;
let abortController = new AbortController();

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

// Start step animation independently (every ~7s per step)
const stepInterval = Math.floor(estimatedMs / (totalSteps + 1));
advanceAnimation(); // step 1 active immediately
for (let i = 1; i < totalSteps; i++) {
  setTimeout(() => { if (!analysisComplete) advanceAnimation(); }, i * stepInterval);
}

// Countdown timer
const timerInterval = setInterval(() => {
  const elapsed = Date.now() - startTime;
  const remaining = Math.max(0, Math.ceil((estimatedMs - elapsed) / 1000));
  if (!analysisComplete) {
    document.getElementById('timerText').textContent = remaining > 0
      ? '⏱️ Estimasi sisa: ~' + remaining + ' detik'
      : '⏱️ Hampir selesai...';
  }
}, 1000);

// Rotate trust messages
const trustInterval = setInterval(() => {
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
  try {
    const response = await fetch(WORKER_URL + '/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cv: cvData, job_desc: jobDesc }),
      signal: abortController.signal
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || 'Server error: ' + response.status);
    }

    const result = await response.json();

    // Store results
    sessionStorage.setItem('gaslamar_scoring', JSON.stringify(result));
    sessionStorage.setItem('gaslamar_cv_key', result.cv_text_key || '');
    sessionStorage.setItem('gaslamar_analyze_time', String(Date.now()));
    if (window.Analytics) Analytics.track('analysis_completed', {
      score: result.skor || null,
      confidence: result.konfidensitas || null,
      time_ms: (() => { const t = sessionStorage.getItem('gaslamar_upload_start'); return t ? Date.now() - parseInt(t, 10) : undefined; })(),
    });

    // Clear pending data
    sessionStorage.removeItem('gaslamar_cv_pending');
    sessionStorage.removeItem('gaslamar_jd_pending');
    sessionStorage.removeItem('gaslamar_filename');

    // Finish animation then redirect
    analysisComplete = true;
    clearInterval(timerInterval);
    clearInterval(trustInterval);
    finishAnimation();

    setTimeout(() => { window.location.replace('hasil.html'); }, 800);

  } catch (err) {
    clearInterval(timerInterval);
    clearInterval(trustInterval);

    if (err.name === 'AbortError') return; // user navigated away

    if (window.Analytics) Analytics.trackError('analysis_api', {
      error_message: (err.message || '').slice(0, 150),
      is_timeout: err.name === 'AbortError',
      is_network: err.name === 'TypeError',
    });

    let msg = err.message || 'Terjadi kesalahan. Coba lagi.';
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      msg = 'Tidak bisa terhubung ke server. Periksa koneksi internet kamu, lalu coba lagi.';
    } else if (err.name === 'AbortError' || msg.includes('timeout') || msg.includes('terlalu lama')) {
      msg = 'Analisis memakan waktu terlalu lama. Coba lagi.';
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
  abortController = new AbortController();
  // Reset step icons
  for (let i = 1; i <= totalSteps; i++) {
    const icon = document.getElementById('step' + i + 'Icon');
    if (icon) { icon.textContent = '○'; icon.className = 'step-status'; icon.style.color = ''; }
  }
  document.getElementById('progressFill').style.width = '0%';
  runAnalysis();
}

// Edit back link
document.getElementById('editBackLink').addEventListener('click', (e) => {
  e.preventDefault();
  if (confirm('Batalkan analisis dan kembali ke halaman upload? Data tidak akan tersimpan.')) {
    abortController.abort();
    clearInterval(timerInterval);
    clearInterval(trustInterval);
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
