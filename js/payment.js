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

// Auto-select tier from sessionStorage (set by URL param on landing/upload)
(function initTier() {
  const stored = sessionStorage.getItem('gaslamar_tier');
  if (stored && TIER_CONFIG[stored]) {
    selectTier(stored);
  }
})();

function selectTier(tier) {
  if (!TIER_CONFIG[tier]) return;
  selectedTier = tier;

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
}

async function proceedToPayment() {
  if (!selectedTier || paymentInProgress) return;

  const cvTextKey = sessionStorage.getItem('gaslamar_cv_key');

  if (!cvTextKey) {
    alert('Data CV tidak ditemukan. Mohon upload CV kamu kembali.');
    window.location.href = 'upload.html';
    return;
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
        cv_text_key: cvTextKey
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Server error: ${response.status}`);
    }

    const { session_id, invoice_url } = await response.json();

    // Save session to localStorage (backup if user closes tab)
    localStorage.setItem('gaslamar_session', session_id);
    localStorage.setItem('gaslamar_tier', selectedTier);

    // Save to sessionStorage too
    sessionStorage.setItem('gaslamar_session', session_id);

    // Redirect to Mayar payment page
    btn.textContent = 'Mengalihkan ke halaman pembayaran...';
    window.location.href = invoice_url;

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
