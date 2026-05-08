// ── Session countdown timer ──
(function startCountdown() {
  const analyzeTime = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0');
  const el = document.getElementById('session-countdown');
  const textEl = document.getElementById('countdown-text');
  if (!analyzeTime || !el || !textEl) { if (el) el.style.display = 'none'; return; }
  const SESSION_SECS = 7200; // matches worker cvtext_ TTL (2h)
  var toastShown = false;

  function showExpiryToast() {
    if (toastShown) return;
    toastShown = true;
    const toast = document.getElementById('expiry-warning-toast');
    if (!toast) return;
    toast.classList.remove('hidden');
    // Auto-dismiss after 30 seconds
    setTimeout(function() { toast.classList.add('hidden'); }, 30000);
  }

  function update() {
    const remaining = SESSION_SECS - Math.floor((Date.now() - analyzeTime) / 1000);
    if (remaining <= 0) {
      textEl.textContent = 'Preview analisis sudah kedaluwarsa — hasil ini masih bisa kamu lihat, tapi tidak bisa lanjut bayar.';
      el.style.background = '#FEF2F2';
      el.style.borderColor = '#FECACA';
      el.style.color = '#B91C1C';
      // M25: Disable pay button when session expires so user doesn't attempt payment
      // that will return a server 404 with no helpful explanation.
      var payBtn = document.getElementById('pay-btn');
      if (payBtn) { payBtn.disabled = true; payBtn.title = 'Sesi sudah berakhir — upload ulang CV kamu untuk lanjut bayar.'; }
      return;
    }
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;
    if (remaining <= 300) {
      if (!toastShown) showExpiryToast();
      el.style.background = '#FEF2F2';
      el.style.borderColor = '#FECACA';
      el.style.color = '#B91C1C';
      textEl.textContent = `⚠️ Preview berakhir dalam ${m}m ${s}s — selesaikan pembayaran sekarang!`;
    } else if (remaining <= 1800) {
      el.style.background = '#FFFBEB';
      el.style.borderColor = '#FCD34D';
      el.style.color = '#92400E';
      textEl.textContent = h > 0
        ? `⏰ Preview analisis berlaku ${h}j ${m}m lagi — bayar sebelum kedaluwarsa`
        : `⏰ Preview analisis berlaku ${m}m ${s}s lagi — bayar sebelum kedaluwarsa`;
    } else {
      textEl.textContent = h > 0
        ? `⏰ Preview analisis berlaku ${h}j ${m}m lagi`
        : `⏰ Preview analisis berlaku ${m}m ${s}s lagi`;
    }
    setTimeout(update, 1000);
  }
  update();
})();

// ── Event bindings for inline handlers removed from HTML ──
document.querySelectorAll('.tier-card').forEach(function(card) {
  card.addEventListener('click', function() { selectTier(card.dataset.tier); });
});
document.getElementById('pay-btn').addEventListener('click', proceedToPayment);

// ── Pre-select tier from sessionStorage (set when user came via ?tier= on upload page) ──
(function preselectTier() {
  var saved = sessionStorage.getItem('gaslamar_tier') || localStorage.getItem('gaslamar_tier');
  if (saved && typeof selectTier === 'function') selectTier(saved);
})();
