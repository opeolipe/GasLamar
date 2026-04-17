// ── Module: download-ui.js ────────────────────────────────────────────────────
// All UI state transitions for the download page.
// Reads cvDataCache from download-state.js (shared concat scope).
//
// NOTE: showDownloadReady intentionally does NOT call showPostDownloadActions.
// That call lives in generateCVContent (download-generation.js) so the caller
// controls sequencing after the download UI is rendered.

// ── showState ─────────────────────────────────────────────────────────────────
// Single entry point for switching between the four top-level page panels.
function showState(id) {
  ['waiting-payment', 'session-error', 'generating-cv', 'download-ready'].forEach(function(s) {
    const el = document.getElementById(s);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
}

// ── showSessionError ──────────────────────────────────────────────────────────
function showSessionError(title, message, retryable) {
  if (retryable === undefined) retryable = false;
  showState('session-error');
  document.getElementById('error-title').textContent = title;
  document.getElementById('session-error-msg').textContent = message;
  const retryBtn   = document.getElementById('error-retry-btn');
  const restartBtn = document.getElementById('error-restart-btn');
  if (retryBtn)   retryBtn.classList.toggle('hidden', !retryable);
  if (restartBtn) restartBtn.classList.toggle('hidden',  retryable);
}

// ── Progress & generating text ────────────────────────────────────────────────
function setProgress(pct) {
  const bar = document.getElementById('progress-bar');
  if (bar) bar.style.width = pct + '%';
}

function setGeneratingText(text) {
  const el = document.getElementById('generating-text');
  if (el) el.textContent = text;
}

// ── showCreditsDashboard ──────────────────────────────────────────────────────
// Shown for returning multi-credit users who have not yet generated a CV in
// this visit. Hides the download grid (nothing to download yet) and surfaces
// the multi-credit entry form.
// Also seeds cvDataCache.tier so generateForNewJob has a valid tier without
// another server round-trip.
function showCreditsDashboard(creditsRemaining, totalCredits, tier) {
  showState('download-ready');

  const grid = document.getElementById('download-grid');
  if (grid) grid.classList.add('hidden');

  // Hide the success header — nothing has been generated yet in this visit
  const successHeader = document.querySelector('#download-ready > .card:nth-child(2) > div:first-child');
  if (successHeader) successHeader.classList.add('hidden');

  const multiSection = document.getElementById('multi-credit-section');
  if (multiSection) {
    const creditsEl = document.getElementById('credits-remaining-count');
    if (creditsEl) creditsEl.textContent = creditsRemaining;
    const totalEl = document.getElementById('credits-total-count');
    if (totalEl) totalEl.textContent = totalCredits;
    multiSection.classList.remove('hidden');
  }

  // Seed cvDataCache so generateForNewJob can read the tier
  cvDataCache = { cv_id: null, cv_en: null, tier: tier || 'single' };
}

// ── showDownloadReady ─────────────────────────────────────────────────────────
// Transitions to the download-ready state and populates all download UI.
function showDownloadReady(cvId, cvEn, tier, isBilingual, creditsRemaining) {
  showState('download-ready');

  // Reveal the EN download section for bilingual tiers
  if (isBilingual) {
    const enSection = document.getElementById('en-section');
    if (enSection) {
      enSection.classList.remove('hidden');
      // Degrade gracefully if EN generation failed despite bilingual tier
      if (!cvEn) {
        enSection.querySelectorAll('.btn-download').forEach(function(btn) {
          btn.disabled = true;
          btn.title = 'CV Bahasa Inggris gagal dibuat. Coba generate ulang.';
        });
      }
    }
  }

  // Populate plain-text fallback textareas (used by mobile copy buttons)
  document.getElementById('cv-text-id').value = cvId || '';
  if (cvEn) document.getElementById('cv-text-en').value = cvEn;

  // Show multi-credit section when credits remain
  if (creditsRemaining > 0) {
    const multiSection = document.getElementById('multi-credit-section');
    if (multiSection) {
      const creditsEl = document.getElementById('credits-remaining-count');
      if (creditsEl) creditsEl.textContent = creditsRemaining;
      const totalEl = document.getElementById('credits-total-count');
      // total_credits is server-authoritative via cvDataCache — '?' instead of guessing
      if (totalEl) totalEl.textContent = cvDataCache ? cvDataCache.total_credits : '?';
      multiSection.classList.remove('hidden');
    }
  }

  // Upgrade nudge when all credits are exhausted
  if (creditsRemaining <= 0) {
    const upgradeEl = document.getElementById('upgrade-nudge');
    if (upgradeEl) {
      if (tier === 'coba' || tier === 'single') {
        upgradeEl.innerHTML =
          '<div class="upsell-card">' +
            '<div class="upsell-saving">\uD83D\uDCB0 Hemat 40% vs beli satuan</div>' +
            '<h3>\uD83C\uDFAF Lagi banyak lamaran?</h3>' +
            '<p>Upgrade ke <strong>3-Pack</strong> \u2014 Rp\u00A0149.000 untuk 3 CV bilingual.' +
            '<br>Lebih hemat, lebih banyak pilihan.</p>' +
            '<a href="upload.html" class="btn-upsell"' +
            ' title="Mulai analisis CV baru dengan paket 3-Pack">Upgrade ke 3-Pack \u2192</a>' +
          '</div>';
      }
      upgradeEl.classList.remove('hidden');
    }
  }

  // Mobile: show copy-text buttons after a short delay so DOCX/PDF appear first
  const isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(navigator.userAgent);
  if (isMobile) {
    const fallback = document.getElementById('mobile-fallback');
    if (fallback) {
      fallback.classList.remove('mobile-download-show');
      setTimeout(function() {
        fallback.classList.add('mobile-download-show');
        fallback.classList.remove('hidden');
        if (isBilingual) {
          const enFallback = document.getElementById('en-fallback');
          if (enFallback) enFallback.classList.remove('hidden');
        }
      }, 2000);
    }
  }
  // Caller (generateCVContent) is responsible for calling showPostDownloadActions
  // after this function returns.
}

// ── showMobileFallback ────────────────────────────────────────────────────────
// Called when DOCX/PDF generation fails — surfaces the plain-text copy UI.
function showMobileFallback() {
  if (!cvDataCache) return;
  document.getElementById('mobile-fallback').classList.remove('hidden');
  document.getElementById('cv-text-id').value = cvDataCache.cv_id || '';
  if (cvDataCache.cv_en) {
    document.getElementById('cv-text-en').value = cvDataCache.cv_en;
    document.getElementById('en-fallback').classList.remove('hidden');
  }
}

// ── copyText ──────────────────────────────────────────────────────────────────
// Copies the content of a textarea to the clipboard and shows brief feedback.
function copyText(textareaId) {
  const el = document.getElementById(textareaId);
  if (!el) return;
  el.select();
  document.execCommand('copy');
  const btn = el.nextElementSibling;
  if (btn) {
    const original = btn.textContent;
    btn.textContent = 'Tersalin!';
    setTimeout(function() { btn.textContent = original; }, 2000);
  }
}
