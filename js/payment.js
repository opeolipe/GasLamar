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
      if (errEl) errEl.classList.add('hidden');
      emailInput.classList.remove('input-error');
      updatePayHint();
    });
  }
});
function selectTier(tier) {
  if (!TIER_CONFIG[tier]) return;
  selectedTier = tier;
  if (window.Analytics) Analytics.track('tier_selected', {
    tier,
    tier_price_idr: TIER_CONFIG[tier].price,
    tier_label: TIER_CONFIG[tier].label,
    is_bilingual: TIER_CONFIG[tier].bilingual,
  });

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
    hint.classList.remove('hidden');
  } else if (!emailValid) {
    hint.textContent = 'Masukkan email yang valid untuk melanjutkan';
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
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
  card.classList.add('email-card-active');
  defaultView.classList.add('hidden');
  multiView.classList.remove('hidden');

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
  input.classList.add('email-input-active');

  // Clear any previous error
  const errEl = document.getElementById('email-error');
  if (errEl) errEl.classList.add('hidden');
}

function showPaymentTransitionOverlay({ tier, invoiceUrl }) {
  const config = TIER_CONFIG[tier];
  const price = config.price.toLocaleString('id-ID');
  const label = config.label;

  let destDomain = 'mayar.id';
  try { destDomain = new URL(invoiceUrl).hostname; } catch (_) {}

  const overlay = document.createElement('div');
  overlay.id = 'payment-transition-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Membuka halaman pembayaran aman');

  overlay.innerHTML = `
    <style>
      #payment-transition-overlay {
        position: fixed; inset: 0;
        background: rgba(241, 245, 255, 0.97);
        backdrop-filter: blur(10px);
        z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
        font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
        animation: glpt-in 0.22s ease-out;
      }
      @keyframes glpt-in { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
      #payment-transition-overlay .glpt-card {
        background: #fff;
        border-radius: 20px;
        box-shadow: 0 24px 64px rgba(27,79,232,0.13), 0 4px 18px rgba(0,0,0,0.06);
        border: 1px solid rgba(27,79,232,0.09);
        padding: 28px 24px 24px;
        max-width: 388px; width: 100%;
      }
      #payment-transition-overlay .glpt-handoff {
        display: flex; align-items: center; justify-content: center; gap: 10px;
        margin-bottom: 20px;
      }
      #payment-transition-overlay .glpt-logo-gl {
        font-size: 14px; font-weight: 800; letter-spacing: -0.4px; color: #1B4FE8;
        display: flex; align-items: center; gap: 5px;
      }
      #payment-transition-overlay .glpt-logo-dot {
        width: 7px; height: 7px; border-radius: 50%; background: #1B4FE8;
        display: inline-block;
      }
      #payment-transition-overlay .glpt-arrow-wrap {
        display: flex; align-items: center; gap: 4px;
      }
      #payment-transition-overlay .glpt-arrow-line {
        width: 28px; height: 1.5px; background: linear-gradient(to right, #c7d7fe, #7dd3fc);
      }
      #payment-transition-overlay .glpt-arrow-head { color: #7dd3fc; font-size: 14px; line-height: 1; }
      #payment-transition-overlay .glpt-logo-mayar {
        font-size: 14px; font-weight: 800; letter-spacing: -0.4px;
        background: linear-gradient(135deg, #0ea5e9, #0369a1);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      #payment-transition-overlay .glpt-sep {
        height: 1px;
        background: linear-gradient(to right, transparent, #e2e8f0 30%, #e2e8f0 70%, transparent);
        margin: 0 -4px 20px;
      }
      #payment-transition-overlay .glpt-pkg {
        text-align: center; margin-bottom: 22px;
      }
      #payment-transition-overlay .glpt-pkg-label {
        font-size: 10.5px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.8px; color: #94a3b8; margin-bottom: 3px;
      }
      #payment-transition-overlay .glpt-pkg-name {
        font-size: 15px; font-weight: 700; color: #334155; margin-bottom: 3px;
      }
      #payment-transition-overlay .glpt-pkg-price {
        font-size: 30px; font-weight: 800; color: #1B4FE8; letter-spacing: -1px;
        line-height: 1.1;
      }
      #payment-transition-overlay .glpt-steps {
        display: flex; flex-direction: column; gap: 9px; margin-bottom: 20px;
      }
      #payment-transition-overlay .glpt-step {
        display: flex; align-items: center; gap: 9px; font-size: 13px;
      }
      #payment-transition-overlay .glpt-step-icon {
        width: 20px; height: 20px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      }
      #payment-transition-overlay .glpt-done .glpt-step-icon { background: #dcfce7; }
      #payment-transition-overlay .glpt-done .glpt-step-text { color: #6b7280; }
      #payment-transition-overlay .glpt-active .glpt-step-icon { background: #eff6ff; }
      #payment-transition-overlay .glpt-active .glpt-step-text {
        color: #1e293b; font-weight: 600;
      }
      #payment-transition-overlay .glpt-spinner {
        width: 12px; height: 12px;
        border: 2px solid #bfdbfe; border-top-color: #1B4FE8;
        border-radius: 50%; animation: glpt-spin 0.75s linear infinite;
      }
      @keyframes glpt-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        #payment-transition-overlay { animation: none; }
        #payment-transition-overlay .glpt-spinner { animation: none; border-top-color: #1B4FE8; opacity: 0.7; }
      }
      #payment-transition-overlay .glpt-trust {
        background: #f0f9ff; border: 1px solid #bae6fd;
        border-radius: 12px; padding: 13px 14px; margin-bottom: 12px;
      }
      #payment-transition-overlay .glpt-trust-header {
        display: flex; align-items: center; gap: 7px;
        font-size: 12.5px; font-weight: 700; color: #0369a1; margin-bottom: 6px;
      }
      #payment-transition-overlay .glpt-trust-body {
        font-size: 12px; color: #334155; line-height: 1.6;
      }
      #payment-transition-overlay .glpt-domain {
        background: #f8fafc; border: 1px solid #e2e8f0;
        border-radius: 10px; padding: 10px 13px; margin-bottom: 14px;
        font-size: 11.5px; color: #475569; line-height: 1.55;
      }
      #payment-transition-overlay .glpt-domain code {
        font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
        font-size: 11px; font-weight: 700; color: #0369a1;
        background: #e0f2fe; padding: 1px 5px; border-radius: 4px;
      }
      #payment-transition-overlay .glpt-footer {
        text-align: center; font-size: 11.5px; color: #94a3b8; line-height: 1.5;
      }
    </style>
    <div class="glpt-card" role="status" aria-live="polite">

      <div class="glpt-handoff" aria-label="Peralihan dari GasLamar ke Mayar">
        <div class="glpt-logo-gl">
          <span class="glpt-logo-dot" aria-hidden="true"></span>GasLamar
        </div>
        <div class="glpt-arrow-wrap" aria-hidden="true">
          <div class="glpt-arrow-line"></div>
          <span class="glpt-arrow-head">&#9658;</span>
        </div>
        <div class="glpt-logo-mayar">Mayar</div>
      </div>

      <div class="glpt-sep" aria-hidden="true"></div>

      <div class="glpt-pkg">
        <div class="glpt-pkg-label">Paket dipilih</div>
        <div class="glpt-pkg-name">${label}</div>
        <div class="glpt-pkg-price">Rp ${price}</div>
      </div>

      <div class="glpt-steps" aria-label="Langkah proses pembayaran">
        <div class="glpt-step glpt-done">
          <div class="glpt-step-icon" aria-hidden="true">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M2 5.5l2.5 2.5L9 3" stroke="#16a34a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="glpt-step-text">CV selesai dianalisis</span>
        </div>
        <div class="glpt-step glpt-done">
          <div class="glpt-step-icon" aria-hidden="true">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M2 5.5l2.5 2.5L9 3" stroke="#16a34a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="glpt-step-text">Invoice berhasil dibuat</span>
        </div>
        <div class="glpt-step glpt-active">
          <div class="glpt-step-icon" aria-hidden="true">
            <div class="glpt-spinner"></div>
          </div>
          <span class="glpt-step-text">Membuka halaman pembayaran aman&hellip;</span>
        </div>
      </div>

      <div class="glpt-trust">
        <div class="glpt-trust-header">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 1.5 2 3.5v3.5c0 2.76 2.13 5.34 5 5.94 2.87-.6 5-3.18 5-5.94V3.5Z" fill="#bae6fd"/>
            <path d="M7 1.5 2 3.5v3.5c0 2.76 2.13 5.34 5 5.94 2.87-.6 5-3.18 5-5.94V3.5Z" stroke="#0369a1" stroke-width="1.2" stroke-linejoin="round" fill="none"/>
            <path d="M4.5 7.1 6.2 8.8 9.5 5" stroke="#0369a1" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Pembayaran aman diproses oleh Mayar
        </div>
        <div class="glpt-trust-body">
          Kamu akan membuka halaman pembayaran resmi dari <strong>Mayar</strong> — platform pembayaran terpercaya di Indonesia.<br>
          GasLamar <strong>tidak menerima atau menyimpan</strong> data pembayaran kamu. Semua proses pembayaran ditangani langsung oleh Mayar.
        </div>
      </div>

      <div class="glpt-domain">
        <strong>Domain akan berubah ke:</strong>
        <code>${destDomain}</code><br>
        <span style="color:#94a3b8">Ini normal &amp; aman — halaman tersebut adalah checkout resmi Mayar.</span>
      </div>

      <div class="glpt-footer">
        Biasanya kurang dari 5 detik&ensp;&middot;&ensp;Sesi analisis kamu tetap tersimpan
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}

async function proceedToPayment() {
  if (!selectedTier || paymentInProgress) return;

  // For new sessions the cv_key is an HttpOnly cookie — not in sessionStorage.
  // For old sessions (analyzed before the cookie migration) it is still in sessionStorage
  // and sent in the request body as a fallback. The server prefers the cookie.
  const legacyCvKey = sessionStorage.getItem('gaslamar_cv_key') || null;

  // Email required for all tiers
  const emailInput = document.getElementById('email-input');
  const capturedEmail = emailInput ? emailInput.value.trim() : '';
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(capturedEmail);

  if (!emailValid) {
    const errEl = document.getElementById('email-error');
    if (errEl) errEl.classList.remove('hidden');
    if (emailInput) {
      emailInput.classList.add('input-error');
      emailInput.focus();
    }
    return;
  }
  const errEl = document.getElementById('email-error');
  if (errEl) errEl.classList.add('hidden');
  if (emailInput) emailInput.classList.remove('input-error');

  if (window.Analytics) {
    // PII: email used intentionally for user identification (user provided it for payment).
    // No CV text, JD text, or sensitive data in event properties.
    Analytics.identify(capturedEmail, { tier: selectedTier, tier_price_idr: TIER_CONFIG[selectedTier].price });
    Analytics.track('payment_initiated', {
      tier: selectedTier,
      tier_price_idr: TIER_CONFIG[selectedTier].price,
      time_ms_since_score: (() => {
        const t = sessionStorage.getItem('gaslamar_score_displayed_at');
        return t ? Date.now() - parseInt(t, 10) : undefined;
      })(),
    });
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
    // Fetch a single-use CSRF token before submitting payment — held in memory only,
    // never written to storage. The backend validates and deletes it on use.
    const csrfRes = await fetch(`${WORKER_URL}/csrf-token`, {
      method: 'GET',
      credentials: 'include',
      signal: controller.signal,
    });
    if (!csrfRes.ok) {
      clearTimeout(timeout);
      resetPayBtn(btn, originalText);
      showPaymentError('Sesi analisis tidak ditemukan. Silakan <a href="upload.html" class="underline font-medium">upload CV lagi</a>.', false);
      return;
    }
    const { csrfToken } = await csrfRes.json();

    // credentials:'include' is required so the browser accepts the session_id
    // HttpOnly cookie returned in the Set-Cookie header of the response.
    // Without this, the cross-origin cookie is silently discarded.
    const response = await fetch(`${WORKER_URL}/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({
        tier: selectedTier,
        // Include cv_text_key only for old sessions that still have it in sessionStorage.
        // New sessions rely on the cv_key HttpOnly cookie sent automatically with credentials.
        ...(legacyCvKey ? { cv_text_key: legacyCvKey } : {}),
        ...(capturedEmail ? { email: capturedEmail } : {}),
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const errMsg = err.message || `Server error: ${response.status}`;
      console.error('[GasLamar] payment error', response.status, err);
      // M22: Check structured error code instead of message substring so renaming
      // the Indonesian message text doesn't silently break this branch.
      if (err.code === 'cv_expired' || err.code === 'cv_key_missing') {
        showExpiryError();
        return;
      }
      if (response.status === 401) {
        resetPayBtn(btn, originalText);
        showPaymentError('Sesi Anda berakhir. Silakan <a href="upload.html" class="underline font-medium">upload CV lagi</a>.', false);
        return;
      }
      if (response.status === 403) {
        resetPayBtn(btn, originalText);
        showExpiryError();
        return;
      }
      if (response.status === 503 || response.status === 502 || err.code === 'PAYMENT_GATEWAY_ERROR') {
        resetPayBtn(btn, originalText);
        showPaymentError('Layanan pembayaran sedang sibuk. Coba lagi dalam beberapa menit.', true);
        return;
      }
      if (response.status === 409) {
        resetPayBtn(btn, originalText);
        showPaymentError('Permintaan sedang diproses. Tunggu sebentar lalu coba lagi.', true);
        return;
      }
      throw new Error(errMsg);
    }

    const { invoice_url } = await response.json();
    if (window.Analytics) Analytics.track('payment_session_created', {
      tier: selectedTier,
      tier_price_idr: TIER_CONFIG[selectedTier].price,
    });

    // Store a non-sensitive presence flag so download-guard.js (Path 2) can let the user
    // through after Mayar's post-payment redirect. The HttpOnly cookie set by the Worker
    // is the authoritative credential for all server-side calls — the actual session_id
    // is never written to client-accessible storage.
    try { localStorage.setItem('gaslamar_has_session', '1'); } catch (_) {}

    // Keep gaslamar_cv_key in sessionStorage so hasil-guard.js passes if the user
    // returns to /hasil after the Mayar redirect (cancel or back-navigation).
    // The actual cvtext_ KV entry was deleted server-side; /get-scoring falls back
    // to the scoring_<token> snapshot preserved by /create-payment.

    // Redirect to Mayar payment page
    // H9 FIX: Always validate invoice_url against the Mayar domain allowlist.
    // The previous code skipped validation for any non-gaslamar.com hostname
    // (staging, QA, direct worker URL) — an attacker-controlled staging env
    // could return any invoice_url and the browser would follow it unchecked.
    // Mayar sandbox URLs are also on *.mayar.id / *.mayar.club, so no exceptions needed.
    // mayar.id / mayar.club — production and sandbox API-issued links
    // mayar.co / sandbox.mayar.co — Mayar sandbox checkout URLs (new sandbox domain)
    // mayar.shop — Mayar sandbox checkout URLs (e.g. olive-41774.mayar.shop)
    // myr.id — Mayar sandbox checkout URLs (legacy, e.g. olive-41774.myr.id)
    const ALLOWED_PAYMENT_HOSTS = ['mayar.id', 'mayar.club', 'mayar.co', 'mayar.shop', 'myr.id'];
    let validInvoiceUrl = false;
    try {
      const parsed = new URL(invoice_url);
      validInvoiceUrl = parsed.protocol === 'https:' &&
        ALLOWED_PAYMENT_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
    } catch (_) {}
    if (!validInvoiceUrl) {
      throw new Error('URL pembayaran tidak valid. Coba lagi.');
    }
    btn.textContent = 'Membuka halaman pembayaran aman...';
    showPaymentTransitionOverlay({ tier: selectedTier, invoiceUrl: invoice_url });
    await new Promise(r => setTimeout(r, 1800));
    window.location.href = invoice_url;

  } catch (err) {
    clearTimeout(timeout);
    resetPayBtn(btn, originalText);

    if (window.Analytics) {
      Analytics.trackError('payment_api', {
        tier: selectedTier,
        is_timeout: err.name === 'AbortError',
        error_message: err.message,
      });
      Analytics.track('payment_failed', {
        tier: selectedTier,
        is_timeout: err.name === 'AbortError',
      });
    }

    console.error('[GasLamar] payment catch', err);
    let msg = 'Gagal menghubungi server. Coba lagi.';
    let retryable = true;
    if (err.name === 'AbortError' || err.name === 'TypeError') {
      msg = 'Koneksi terputus. Periksa internet Anda dan coba lagi.';
    } else if (err.message) {
      msg = err.message;
    }
    showPaymentError(msg, retryable);
  }
}

function resetPayBtn(btn, originalText) {
  paymentInProgress = false;
  if (btn) { btn.disabled = false; btn.textContent = originalText; }
}

function showPaymentError(message, retryable) {
  const ctaArea = document.getElementById('cta-area');
  // Remove existing error
  const existing = document.getElementById('payment-error');
  if (existing) existing.remove();

  const errDiv = document.createElement('div');
  errDiv.id = 'payment-error';
  errDiv.className = 'mt-3 p-3 bg-red-100 border border-red-300 rounded-xl text-red-800 text-sm text-center';
  errDiv.setAttribute('role', 'alert');

  const msgP = document.createElement('p');
  msgP.innerHTML = message;
  errDiv.appendChild(msgP);

  if (retryable) {
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.textContent = 'Coba Lagi';
    retryBtn.className = 'mt-2 px-4 py-1 bg-red-700 text-white text-xs rounded-lg hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-500';
    retryBtn.addEventListener('click', function() {
      const payBtn = document.getElementById('pay-btn');
      if (payBtn) payBtn.click();
    });
    errDiv.appendChild(retryBtn);
  }

  if (ctaArea) ctaArea.after(errDiv);
}

function showExpiryError() {
  paymentInProgress = false;
  const btn = document.getElementById('pay-btn');
  if (btn) { btn.disabled = true; }

  const ctaArea = document.getElementById('cta-area');
  const existing = document.getElementById('payment-error');
  if (existing) existing.remove();

  const errDiv = document.createElement('div');
  errDiv.id = 'payment-error';
  errDiv.className = 'mt-3 p-3 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-sm text-center';

  const msg = document.createTextNode('Waktu analisis sudah habis. ');
  const link = document.createElement('a');
  link.href = 'upload.html';
  link.className = 'underline font-medium';
  link.textContent = 'Upload CV kembali untuk melanjutkan pembayaran.';

  errDiv.appendChild(msg);
  errDiv.appendChild(link);
  if (ctaArea) ctaArea.after(errDiv);
}

// DevTools deterrent — educational notice, not a security control.
// The backend re-validates tier and price on every /create-payment call,
// so client-side manipulation cannot change what the user is charged.
console.log(
  '%c⚠️ GasLamar — Perhatian',
  'color:#92400E;background:#FFFBEB;font-size:14px;font-weight:700;padding:4px 10px;border-radius:4px;border:1px solid #FDE68A;'
);
console.log(
  '%cMengubah nilai di DevTools tidak akan mempengaruhi harga sebenarnya.\n' +
  'Pembayaran diproses oleh Mayar.id sesuai paket yang dipilih saat tombol bayar diklik.\n' +
  'Tier dan harga divalidasi ulang di server — tidak bisa dimanipulasi dari browser.',
  'color:#374151;font-size:14px;line-height:1.7;'
);
