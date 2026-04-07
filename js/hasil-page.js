// ── Session countdown timer ──
(function startCountdown() {
  const analyzeTime = parseInt(sessionStorage.getItem('gaslamar_analyze_time') || '0');
  const el = document.getElementById('session-countdown');
  const textEl = document.getElementById('countdown-text');
  if (!analyzeTime || !el || !textEl) { if (el) el.style.display = 'none'; return; }
  const SESSION_SECS = 7200; // matches worker cvtext_ TTL (2h)
  function update() {
    const remaining = SESSION_SECS - Math.floor((Date.now() - analyzeTime) / 1000);
    if (remaining <= 0) {
      textEl.textContent = 'Sesi analisis sudah kedaluwarsa - hasil ini masih bisa kamu lihat, tapi tidak bisa lanjut bayar.';
      el.style.background = '#FEF2F2';
      el.style.borderColor = '#FECACA';
      el.style.color = '#B91C1C';
      return;
    }
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;
    if (remaining <= 300) {
      el.style.background = '#FEF2F2';
      el.style.borderColor = '#FECACA';
      el.style.color = '#B91C1C';
      textEl.textContent = `⚠️ Sesi berakhir dalam ${m}m ${s}s — selesaikan pembayaran sekarang!`;
    } else if (remaining <= 1800) {
      el.style.background = '#FFFBEB';
      el.style.borderColor = '#FCD34D';
      el.style.color = '#92400E';
      textEl.textContent = h > 0
        ? `Sesi analisis berlaku ${h}j ${m}m lagi - bayar sebelum kedaluwarsa`
        : `Sesi analisis berlaku ${m}m ${s}s lagi - bayar sebelum kedaluwarsa`;
    } else {
      textEl.textContent = h > 0
        ? `Sesi analisis berlaku ${h}j ${m}m lagi - bayar sebelum kedaluwarsa`
        : `Sesi analisis berlaku ${m}m ${s}s lagi - bayar sebelum kedaluwarsa`;
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
