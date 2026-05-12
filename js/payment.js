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
  sessionStorage.setItem('gaslamar_tier', tier);
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

  // Store email in sessionStorage for use on download page
  if (capturedEmail && emailValid) {
    sessionStorage.setItem('gaslamar_email', capturedEmail);
  }

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

  // Generate a cryptographically random secret — stored client-side and used
  // to bind subsequent requests (get-session, generate) to this browser session.
  // The worker stores only SHA-256(secret), so possession of the session ID
  // alone is insufficient to access CV data.
  // crypto.randomUUID() is Safari 15.4+; fall back to getRandomValues for older Safari
  const sessionSecret = crypto.randomUUID
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    // credentials:'include' is required so the browser accepts the session_id
    // HttpOnly cookie returned in the Set-Cookie header of the response.
    // Without this, the cross-origin cookie is silently discarded.
    const response = await fetch(`${WORKER_URL}/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        tier: selectedTier,
        cv_text_key: cvTextKey,
        session_secret: sessionSecret,
        ...(capturedEmail ? { email: capturedEmail } : {}),
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const errMsg = err.message || `Server error: ${response.status}`;
      // M22: Check structured error code instead of message substring so renaming
      // the Indonesian message text doesn't silently break this branch.
      if (err.code === 'cv_expired' || response.status === 403) {
        showExpiryError();
        return;
      }
      throw new Error(errMsg);
    }

    const { session_id, invoice_url } = await response.json();
    if (window.Analytics) Analytics.track('payment_session_created', {
      tier: selectedTier,
      tier_price_idr: TIER_CONFIG[selectedTier].price,
    });

    // Save session ID to localStorage (survives tab close; not sensitive — no auth value alone).
    localStorage.setItem('gaslamar_session', session_id);
    // Secret stored in sessionStorage only (tab-scoped). Survives the Mayar redirect
    // because sessionStorage persists within the same tab. After tab close, users must
    // use their email link (?token=) to re-access — this is intentional security hardening.
    sessionStorage.setItem('gaslamar_secret_' + session_id, sessionSecret);
    // Note: gaslamar_tier is intentionally NOT persisted to localStorage.
    // The authoritative tier is always read from the server (/check-session → data.tier)
    // and written to sessionStorage there. Client-side storage of tier is display-only.

    // cv_text_key has been consumed server-side — remove from session
    sessionStorage.removeItem('gaslamar_cv_key');

    // Redirect to Mayar payment page
    // H9 FIX: Always validate invoice_url against the Mayar domain allowlist.
    // The previous code skipped validation for any non-gaslamar.com hostname
    // (staging, QA, direct worker URL) — an attacker-controlled staging env
    // could return any invoice_url and the browser would follow it unchecked.
    // Mayar sandbox URLs are also on *.mayar.id / *.mayar.club, so no exceptions needed.
    const ALLOWED_PAYMENT_HOSTS = ['mayar.id', 'mayar.club'];
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
    paymentInProgress = false;
    btn.disabled = false;
    btn.textContent = originalText;

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
    <p class="text-yellow-700 text-sm mb-3">Upload ulang CV kamu untuk melanjutkan.</p>
    <a href="upload.html" class="inline-block bg-primary text-white font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-blue-700 transition-colors">
      Upload CV Lagi →
    </a>`;
  ctaArea.after(errDiv);
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
