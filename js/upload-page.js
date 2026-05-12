// Detects the first strongly-directional character and sets dir="rtl"|"ltr".
// RTL ranges: Arabic, Hebrew, Thaana, Syriac, and broad RTL category.
function setTextDir(el) {
  const RTL = /[\u0591-\u07FF\u200F\u202B\u202E\uFB1D-\uFDFD\uFE70-\uFEFC]/;
  el.dir = RTL.test(el.value) ? 'rtl' : 'ltr';
}

// Show error from analyzing.html if analysis failed
const _analyzeErr = sessionStorage.getItem('gaslamar_upload_error');
if (_analyzeErr) {
  sessionStorage.removeItem('gaslamar_upload_error');
  const _errEl = document.createElement('div');
  _errEl.className = 'upload-error-banner';
  _errEl.innerHTML = '<span aria-hidden="true">⚠️</span> Analisis gagal: ' + _analyzeErr.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  document.querySelector('.card').insertBefore(_errEl, document.querySelector('.card').firstChild);
}

// If a previous analysis session is still active, remind the user so they don't
// accidentally abandon their existing results by starting a new upload.
(function() {
  const analyzeTime = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0');
  if (!analyzeTime || !sessionStorage.getItem('gaslamar_scoring')) return;
  const remaining = 7200 - Math.floor((Date.now() - analyzeTime) / 1000);
  if (remaining <= 0) return; // already expired — no stale results to surface
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const timeLabel = h > 0 ? h + 'j ' + m + 'm' : m + ' menit';
  const notice = document.createElement('p');
  notice.className = 'session-notice-banner';
  notice.setAttribute('role', 'status');
  notice.textContent = '\u23F0 Kamu masih punya hasil analisis aktif (' + timeLabel + ' tersisa). ';
  const link = document.createElement('a');
  link.href = 'hasil.html';
  link.style.cssText = 'color:#1E40AF;font-weight:600;';
  link.textContent = 'Lihat hasil \u2192';
  notice.appendChild(link);
  const card = document.querySelector('.card');
  if (card) card.insertBefore(notice, card.firstChild);
})();

// Show informational notice when redirected from hasil.html or download.html
const _redirectParams = new URLSearchParams(window.location.search);
const _redirectReason = _redirectParams.get('reason');
if (_redirectReason === 'session_expired' || _redirectReason === 'no_session') {
  history.replaceState(null, '', window.location.pathname);
  const _noticeEl = document.createElement('div');
  _noticeEl.className = 'session-notice-banner';
  _noticeEl.textContent = _redirectReason === 'no_session'
    ? 'Sesi download tidak ditemukan. Silakan upload CV dan selesaikan pembayaran.'
    : 'Sesi analisis tidak ditemukan atau sudah kadaluarsa. Silakan upload ulang CV kamu.';
  document.querySelector('.card').insertBefore(_noticeEl, document.querySelector('.card').firstChild);
}

// Hide scroll hint once submit button scrolls into view
const _scrollHint = document.getElementById('scroll-hint');
const _submitBtn = document.getElementById('submit-btn');
if (_scrollHint && _submitBtn && 'IntersectionObserver' in window) {
  const _obs = new IntersectionObserver(([e]) => {
    if (e.isIntersecting) { _scrollHint.classList.add('hidden'); _obs.disconnect(); }
  }, { threshold: 0.5 });
  _obs.observe(_submitBtn);
}

// Fetch job description from URL
document.getElementById('fetch-url-btn').addEventListener('click', () => {
  const row = document.getElementById('url-fetch-row');
  row.style.display = 'block';
  document.getElementById('job-url-input').focus();
});

function closeUrlFetch() {
  document.getElementById('url-fetch-row').style.display = 'none';
  document.getElementById('url-fetch-status').textContent = '';
  document.getElementById('job-url-input').value = '';
}

async function fetchJobFromUrl() {
  const urlInput = document.getElementById('job-url-input');
  const statusEl = document.getElementById('url-fetch-status');
  const submitBtn = document.getElementById('fetch-url-submit-btn');
  const url = urlInput.value.trim();

  if (!url) { urlInput.focus(); return; }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Mengambil...';
  statusEl.style.color = '#6B7280';
  statusEl.textContent = '⏳ Mengambil job description...';

  try {
    const res = await fetch(`${WORKER_URL}/fetch-job-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();

    if (!res.ok) {
      statusEl.style.color = '#DC2626';
      statusEl.innerHTML = '<span aria-hidden="true">⚠️</span> ' + (data.message || 'Gagal mengambil. Coba copy-paste manual.');
    } else {
      document.getElementById('job-desc').value = data.job_desc;
      updateCharCount();
      statusEl.style.color = '#059669';
      statusEl.innerHTML = '<span aria-hidden="true">✅</span> Job description berhasil diambil. Periksa dan edit seperlunya.';
    }
  } catch {
    statusEl.style.color = '#DC2626';
    statusEl.innerHTML = '<span aria-hidden="true">⚠️</span> Tidak bisa terhubung ke server. Coba lagi.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Ambil';
  }
}

// Allow Enter key in URL input to trigger fetch
document.getElementById('job-url-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') fetchJobFromUrl();
});

// ── Event bindings for inline handlers removed from HTML ──
document.getElementById('drop-zone').addEventListener('click', function(e) {
  if (!e.target.closest('#drop-preview')) document.getElementById('cv-file').click();
});
document.getElementById('drop-zone').addEventListener('keydown', function(e) {
  if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('#drop-preview')) {
    e.preventDefault(); // prevent Space from scrolling the page
    document.getElementById('cv-file').click();
  }
});
document.getElementById('drop-zone').addEventListener('dragover', handleDragOver);
document.getElementById('drop-zone').addEventListener('dragleave', handleDragLeave);
document.getElementById('drop-zone').addEventListener('drop', handleDrop);
document.querySelector('.btn-pick-file').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('cv-file').click();
});
document.getElementById('cv-file').addEventListener('change', handleFileSelect);
document.querySelector('.replace-btn').addEventListener('click', function(e) {
  e.stopPropagation();
  removeFile();
});
document.getElementById('fetch-url-submit-btn').addEventListener('click', fetchJobFromUrl);
document.querySelector('#url-fetch-row .btn-close-icon').addEventListener('click', closeUrlFetch);
document.getElementById('job-desc').addEventListener('input', function() {
  updateCharCount();
  setTextDir(this);
});
// Staging test panel — only loads on staging/localhost, no-op in production
(function() {
  const h = window.location.hostname;
  if (h.includes('staging') || h === 'localhost' || h === '127.0.0.1') {
    const s = document.createElement('script');
    s.src = 'js/staging-cvs.js';
    document.body.appendChild(s);
  }
})();
