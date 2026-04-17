// ── Module: download-countdown.js ────────────────────────────────────────────
// Session expiry countdown banner.
// Reads/writes countdownInterval from download-state.js (shared concat scope).

// ── startCountdown ────────────────────────────────────────────────────────────
// Populates #session-countdown with a live remaining-time label and
// #expiry-date-text with a static absolute date/time stamp.
//
// Validity periods:  multi-credit packs (3-Pack / Job Hunt) → 30 days
//                    single-credit (coba / single)          →  7 days
// Warning threshold: multi-credit → 1 day left
//                    single-credit → 1 hour left
function startCountdown(expiresAtMs, totalCredits) {
  if (!expiresAtMs) return;

  const bar  = document.getElementById('session-countdown');
  const text = document.getElementById('countdown-text');
  if (!bar || !text) return;

  const isMulti           = (totalCredits || 1) > 1;
  const validityLabel     = isMulti ? '30 hari' : '7 hari';
  const WARNING_THRESHOLD_MS = isMulti ? 86400000 : 3600000; // 1 day : 1 hour

  function update() {
    const msLeft = expiresAtMs - Date.now();

    if (msLeft <= 0) {
      text.textContent = `\u23F0 Sesi kedaluwarsa \u2014 download tidak lagi tersedia (berlaku ${validityLabel}).`;
      bar.style.background   = '#FEF2F2';
      bar.style.borderColor  = '#FECACA';
      bar.style.color        = '#B91C1C';
      return;
    }

    const days  = Math.floor(msLeft / 86400000);
    const hours = Math.floor((msLeft % 86400000) / 3600000);
    const mins  = Math.floor((msLeft % 3600000)  / 60000);

    if (msLeft <= WARNING_THRESHOLD_MS) {
      // Near-expiry: amber warning style
      bar.style.background   = '#FFFBEB';
      bar.style.borderColor  = '#FCD34D';
      bar.style.color        = '#92400E';
      if (days > 0) {
        text.textContent = `\u26A0\uFE0F Link berakhir dalam ${days} hari \u2014 segera selesaikan download kamu!`;
      } else if (hours > 0) {
        text.textContent = `\u26A0\uFE0F Link berakhir dalam ${hours} jam ${mins} menit \u2014 segera selesaikan download kamu!`;
      } else {
        text.textContent = `\u26A0\uFE0F Link berakhir dalam ${mins} menit \u2014 segera selesaikan download kamu!`;
      }
    } else {
      // Normal: show total validity alongside remaining time
      if (days > 0) {
        text.textContent = `Link berlaku ${validityLabel} \u00B7 Berakhir dalam ${days} hari ${hours} jam`;
      } else {
        text.textContent = `Link berlaku ${validityLabel} \u00B7 Berakhir dalam ${hours} jam ${mins} menit`;
      }
    }
  }

  // Render immediately, then refresh every minute
  update();
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(update, 60000);

  // Static absolute date/time — shown once, never re-rendered
  const expiryEl = document.getElementById('expiry-date-text');
  if (expiryEl) {
    const d       = new Date(expiresAtMs);
    const dateStr = d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    expiryEl.textContent  = '\uD83D\uDCC5 Link berlaku hingga ' + dateStr + ' pukul ' + timeStr;
    expiryEl.style.display = '';
  }

  bar.style.display = 'block';
  document.body.classList.add('has-countdown');
}
