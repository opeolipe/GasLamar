// ── Generating animation ──
const GEN_TRUST_MSGS = [
  '🔒 CV tidak disimpan — data aman',
  '🎯 Setiap bullet disesuaikan dengan lowonganmu',
  '📧 Link download akan dikirim ke email kamu',
];
let _genTrustIdx = 0, _genTrustTimer = null, _genTimerTimer = null, _genStartTime = null;

function startGeneratingAnimation() {
  const filename = sessionStorage.getItem('gaslamar_filename') || 'CV kamu';
  const tier = sessionStorage.getItem('gaslamar_tier') || 'single';
  const tierLabel = { coba:'Coba Dulu', single:'Single', '3pack':'3-Pack', jobhunt:'Job Hunt Pack' }[tier] || tier;
  document.getElementById('gen-filename').textContent = filename;
  document.getElementById('gen-tier').textContent = 'Paket: ' + tierLabel;

  _genStartTime = Date.now();
  _genTrustTimer = setInterval(() => {
    _genTrustIdx = (_genTrustIdx + 1) % GEN_TRUST_MSGS.length;
    const el = document.getElementById('gen-trust');
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = GEN_TRUST_MSGS[_genTrustIdx]; el.style.opacity = '1'; }, 150);
  }, 5000);
  const EST = 22;
  _genTimerTimer = setInterval(() => {
    const elapsed = (Date.now() - _genStartTime) / 1000;
    const rem = Math.max(0, Math.ceil(EST - elapsed));
    const el = document.getElementById('gen-timer');
    if (rem <= 0) { el.textContent = '✅ CV siap! Memuat file...'; clearInterval(_genTimerTimer); }
    else el.textContent = `⏱️ Estimasi sisa: ~${rem} detik`;
  }, 1000);
}

function stopGeneratingAnimation() {
  clearInterval(_genTrustTimer);
  clearInterval(_genTimerTimer);
}

// Map progress % → step icons
function updateGenSteps(pct) {
  const thresholds = [10, 40, 70, 90];
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('gsi-' + i);
    if (!el) continue;
    if (pct >= thresholds[i-1] + 20) {
      el.textContent = '✓'; el.className = 'step-icon done';
    } else if (pct >= thresholds[i-1]) {
      el.textContent = '⟳'; el.className = 'step-icon spin';
    } else {
      el.textContent = '○'; el.className = 'step-icon pending';
    }
  }
}

// Use MutationObserver to hook into download.js state changes without patching functions
// (function patching causes hoisting bugs — MutationObserver is safe)

// Watch generating-cv visibility → start/stop animation
new MutationObserver(() => {
  const el = document.getElementById('generating-cv');
  if (!el.classList.contains('hidden')) startGeneratingAnimation();
  else stopGeneratingAnimation();
}).observe(document.getElementById('generating-cv'), { attributes: true, attributeFilter: ['class'] });

// Watch progress-bar width → update step icons
new MutationObserver(() => {
  const pct = parseFloat(document.getElementById('progress-bar').style.width) || 0;
  updateGenSteps(pct);
}).observe(document.getElementById('progress-bar'), { attributes: true, attributeFilter: ['style'] });

// ── Sandbox detection ──
(function checkSandbox() {
  fetch(WORKER_URL + '/sandbox/status')
    .then(r => { if (r.ok) document.getElementById('sandbox-pay-btn').classList.remove('hidden'); })
    .catch(() => {});
})();

async function sandboxConfirmPayment() {
  const btn = document.getElementById('sandbox-pay-btn');
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session') || localStorage.getItem('gaslamar_session');
  if (!sessionId) return;
  btn.disabled = true;
  btn.textContent = 'Mengkonfirmasi...';
  try {
    const res = await fetch(WORKER_URL + '/sandbox/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    });
    if (res.ok) {
      btn.textContent = '✓ Dikonfirmasi — memuat CV...';
      restartPolling();
    } else {
      btn.textContent = '🧪 Simulasi Pembayaran (Sandbox)';
      btn.disabled = false;
    }
  } catch {
    btn.textContent = '🧪 Simulasi Pembayaran (Sandbox)';
    btn.disabled = false;
  }
}

// ── Multi-credit: URL fetch for next job ──
document.getElementById('new-fetch-url-btn').addEventListener('click', () => {
  const row = document.getElementById('new-url-fetch-row');
  row.style.display = 'block';
  document.getElementById('new-job-url-input').focus();
});

document.getElementById('new-job-url-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') fetchNewJobFromUrl();
});

document.getElementById('new-example-btn').addEventListener('click', () => {
  document.getElementById('new-job-desc').value = `Posisi: Software Engineer

Requirements:
- S1 Teknik Informatika atau terkait
- 2+ tahun pengalaman sebagai Software Engineer
- Menguasai JavaScript / TypeScript dan salah satu framework (React, Vue, Node.js)
- Pengalaman dengan REST API dan version control (Git)
- Kemampuan problem-solving yang baik dan senang belajar hal baru`;
  updateNewCharCount();
});

async function fetchNewJobFromUrl() {
  const urlInput = document.getElementById('new-job-url-input');
  const statusEl = document.getElementById('new-url-fetch-status');
  const submitBtn = document.getElementById('new-fetch-submit-btn');
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
      statusEl.textContent = '⚠️ ' + (data.message || 'Gagal mengambil. Coba copy-paste manual.');
    } else {
      document.getElementById('new-job-desc').value = data.job_desc;
      updateNewCharCount();
      statusEl.style.color = '#059669';
      statusEl.textContent = '✅ Job description berhasil diambil. Periksa dan edit seperlunya.';
    }
  } catch {
    statusEl.style.color = '#DC2626';
    statusEl.textContent = '⚠️ Tidak bisa terhubung ke server. Coba lagi.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Ambil';
  }
}

function updateNewCharCount() {
  const val = document.getElementById('new-job-desc').value.length;
  document.getElementById('new-char-count').textContent = val.toLocaleString('id-ID');
  const warn = document.getElementById('new-char-warning');
  if (val > 4500) warn.classList.remove('hidden');
  else warn.classList.add('hidden');
}

// ── Bottom CTA: scroll to multi-credit if credits remain, else show upgrade nudge ──
function handleTailoringCta() {
  const multiSection = document.getElementById('multi-credit-section');
  if (multiSection && !multiSection.classList.contains('hidden')) {
    multiSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => document.getElementById('new-job-desc').focus(), 600);
    return;
  }
  // Credits exhausted — show upgrade nudge and scroll to it
  const upgradeEl = document.getElementById('upgrade-nudge');
  if (upgradeEl) {
    upgradeEl.classList.remove('hidden');
    upgradeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function submitInterviewFeedback(answer) {
  document.getElementById('feedback-buttons').classList.add('hidden');
  document.getElementById('feedback-thanks').classList.remove('hidden');
  fetch(`${WORKER_URL}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'interview_outcome', answer })
  }).catch(() => {});
}
