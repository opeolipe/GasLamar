/**
 * payment.js — GasLamar
 * Handles tier selection, create payment session via Worker, redirect to Mayar
 * Requires: js/config.js (defines WORKER_URL)
 */

const TIER_CONFIG = {
  coba:    { label: 'Coba Dulu',      price: 29000,  bilingual: false },
  single:  { label: 'Single',         price: 59000,  bilingual: true  },
  '3pack': { label: '3-Pack',         price: 149000, bilingual: true  },
  jobhunt: { label: 'Job Hunt Pack',  price: 299000, bilingual: true  },
};

let selectedTier = null;
let paymentInProgress = false;

// Show amber email section with single/coba copy by default (before any tier is selected)
document.addEventListener('DOMContentLoaded', () => {
  updateEmailSection('single');
  // Clear email error state as user types, and update hint
  const emailInput = document.getElementById('email-input');
  if (emailInput) {
    emailInput.addEventListener('input', () => {
      const errEl = document.getElementById('email-error');
      if (errEl) errEl.style.display = 'none';
      emailInput.style.borderColor = '';
      updatePayHint();
    });
  }
});
function selectTier(tier) {
  if (!TIER_CONFIG[tier]) return;
  selectedTier = tier;
  sessionStorage.setItem('gaslamar_tier', tier);

  // Update UI — deselect all, select chosen
  document.querySelectorAll('.tier-card').forEach(card => {
    card.classList.remove('selected');
  });
  const chosen = document.querySelector(`[data-tier="${tier}"]`);
  if (chosen) chosen.classList.add('selected');

  // Update pay button
  const btn = document.getElementById('pay-btn');
  if (btn) {
    const config = TIER_CONFIG[tier];
    btn.disabled = false;
    btn.textContent = `Bayar Rp ${config.price.toLocaleString('id-ID')} — ${config.label} →`;
  }

  // Transform email section based on tier
  updateEmailSection(tier);

  updatePayHint();
}

function updatePayHint() {
  const hint = document.getElementById('pay-hint');
  if (!hint) return;
  const email = document.getElementById('email-input')?.value.trim() || '';
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!selectedTier) {
    hint.textContent = 'Pilih paket di atas untuk melanjutkan';
    hint.style.display = 'block';
  } else if (!emailValid) {
    hint.textContent = 'Masukkan email yang valid untuk melanjutkan';
    hint.style.display = 'block';
  } else {
    hint.style.display = 'none';
  }
}

function updateEmailSection(tier) {
  const card = document.getElementById('email-card');
  const defaultView = document.getElementById('email-default');
  const multiView = document.getElementById('email-multi');
  const input = document.getElementById('email-input');
  if (!card || !defaultView || !multiView || !input) return;

  // All tiers now show the prominent amber email section
  const slot = document.getElementById('email-multi-slot');
  if (slot && !slot.contains(input)) slot.appendChild(input);
  card.style.borderColor = '#F59E0B';
  card.style.background = '#FFFBEB';
  defaultView.style.display = 'none';
  multiView.style.display = 'block';

  const titleEl = document.getElementById('email-multi-title');
  const bodyEl = document.getElementById('email-multi-body');
  const helperEl = document.getElementById('email-helper');

  if (tier === '3pack') {
    if (titleEl) titleEl.innerHTML = 'Masukkan email aktif kamu <span style="color:#DC2626;">*</span>';
    if (bodyEl) bodyEl.innerHTML = 'Kami kirim 1 link akses ke email kamu.<br>Pakai link ini untuk generate CV yang sudah disesuaikan hingga <strong>3 lowongan berbeda</strong> dalam 30 hari — tanpa perlu login.';
    if (helperEl) helperEl.textContent = '🔒 Link pribadi kamu — bisa dipakai ulang kapan saja selama 30 hari';
  } else if (tier === 'jobhunt') {
    if (titleEl) titleEl.innerHTML = 'Masukkan email aktif kamu <span style="color:#DC2626;">*</span>';
    if (bodyEl) bodyEl.innerHTML = 'Kami kirim 1 link akses ke email kamu.<br>Gunakan link ini untuk generate CV yang sudah dioptimasi hingga <strong>10 lowongan berbeda</strong> dalam 30 hari — tanpa login.';
    if (helperEl) helperEl.textContent = '⚡ 1 link untuk semua lamaran kamu selama 30 hari';
  } else {
    // single / coba dulu
    if (titleEl) titleEl.innerHTML = 'Masukkan email untuk menerima link download CV kamu <span style="color:#DC2626;">*</span>';
    if (bodyEl) bodyEl.innerHTML = 'Kami kirim 1 link akses ke email kamu setelah pembayaran berhasil.<br>Link berlaku selama <strong>7 hari</strong> — tanpa perlu login.';
    if (helperEl) helperEl.textContent = '🔒 Link download pribadimu — tersedia selama 7 hari';
  }

  input.placeholder = 'contoh@email.com';
  input.style.cssText = 'width:100%;padding:0.75rem 1rem;border:1.5px solid #D97706;border-radius:10px;font-size:0.95rem;box-sizing:border-box;';

  // Clear any previous error
  const errEl = document.getElementById('email-error');
  if (errEl) errEl.style.display = 'none';
}

async function proceedToPayment() {
  if (!selectedTier || paymentInProgress) return;

  const cvTextKey = sessionStorage.getItem('gaslamar_cv_key');

  if (!cvTextKey) {
    alert('Data CV tidak ditemukan. Mohon upload CV kamu kembali.');
    window.location.href = 'upload.html';
    return;
  }

  // Email required for all tiers
  const emailInput = document.getElementById('email-input');
  const capturedEmail = emailInput ? emailInput.value.trim() : '';
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(capturedEmail);

  if (!emailValid) {
    const errEl = document.getElementById('email-error');
    if (errEl) errEl.style.display = 'block';
    if (emailInput) {
      emailInput.style.borderColor = '#DC2626';
      emailInput.focus();
    }
    return;
  }
  const errEl = document.getElementById('email-error');
  if (errEl) errEl.style.display = 'none';
  if (emailInput) emailInput.style.borderColor = '';

  // Store email in sessionStorage for use on download page
  if (capturedEmail && emailValid) {
    sessionStorage.setItem('gaslamar_email', capturedEmail);
  }

  // Prevent double payment
  paymentInProgress = true;
  const btn = document.getElementById('pay-btn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Membuat invoice...';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(`${WORKER_URL}/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier: selectedTier,
        cv_text_key: cvTextKey,
        ...(capturedEmail ? { email: capturedEmail } : {}),
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const errMsg = err.message || `Server error: ${response.status}`;
      // Session expiry gets a friendlier re-upload prompt
      if (response.status === 400 && errMsg.includes('kedaluwarsa')) {
        showExpiryError();
        return;
      }
      throw new Error(errMsg);
    }

    const { session_id, invoice_url, is_sandbox } = await response.json();

    // Save session to localStorage (backup if user closes tab)
    localStorage.setItem('gaslamar_session', session_id);
    localStorage.setItem('gaslamar_tier', selectedTier);

    // Save to sessionStorage too
    sessionStorage.setItem('gaslamar_session', session_id);

    if (is_sandbox) {
      // Sandbox: skip Mayar, go directly to download page with Simulasi Pembayaran button
      btn.textContent = 'Mengalihkan...';
      window.location.href = `${window.location.origin}/download.html?session=${encodeURIComponent(session_id)}`;
    } else {
      // Production: redirect to real Mayar payment page
      btn.textContent = 'Mengalihkan ke halaman pembayaran...';
      window.location.href = invoice_url;
    }

  } catch (err) {
    clearTimeout(timeout);
    paymentInProgress = false;
    btn.disabled = false;
    btn.textContent = originalText;

    let msg = 'Terjadi kesalahan. Coba lagi.';
    if (err.name === 'AbortError') {
      msg = 'Koneksi timeout. Coba lagi.';
    } else if (err.message) {
      msg = err.message;
    }
    showPaymentError(msg);
  }
}

function showPaymentError(message) {
  const ctaArea = document.getElementById('cta-area');
  // Remove existing error
  const existing = document.getElementById('payment-error');
  if (existing) existing.remove();

  const errDiv = document.createElement('div');
  errDiv.id = 'payment-error';
  errDiv.className = 'mt-3 p-3 bg-red-100 border border-red-300 rounded-xl text-red-800 text-sm text-center';
  errDiv.textContent = message;
  ctaArea.after(errDiv);
}

function showExpiryError() {
  paymentInProgress = false;
  const btn = document.getElementById('pay-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sesi kedaluwarsa'; }

  const ctaArea = document.getElementById('cta-area');
  const existing = document.getElementById('payment-error');
  if (existing) existing.remove();

  const errDiv = document.createElement('div');
  errDiv.id = 'payment-error';
  errDiv.className = 'mt-4 p-4 bg-yellow-50 border border-yellow-300 rounded-xl text-center';
  errDiv.innerHTML = `
    <p class="text-yellow-800 font-semibold text-sm mb-2">Sesi analisis sudah kedaluwarsa (30 menit)</p>
    <p class="text-yellow-700 text-xs mb-3">Upload ulang CV kamu untuk melanjutkan.</p>
    <a href="upload.html" class="inline-block bg-primary text-white font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-blue-700 transition-colors">
      Upload CV Lagi →
    </a>`;
  ctaArea.after(errDiv);
}
