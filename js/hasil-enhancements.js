/**
 * Hasil page enhancement — runs after scoring.js async rendering is complete.
 * scoring.js dispatches 'gaslamar:scored' after all render calls finish,
 * which is after window 'load' when the initScoring IIFE is async.
 */
window.addEventListener('gaslamar:scored', function () {
  // 1. Count gap items BEFORE truncation (original total → used in sentence)
  var gapItems  = document.querySelectorAll('#gap-list li');
  var recoItems = document.querySelectorAll('#reco-list li');
  var gapCount  = gapItems.length;

  // 2. Truncate gap-list and reco-list to first 3 items
  gapItems.forEach(function (li, i)  { if (i >= 3) li.style.display = 'none'; });
  recoItems.forEach(function (li, i) { if (i >= 3) li.style.display = 'none'; });

  // 3. Dynamic guiding sentence based on original gap count
  var sentenceEl = document.getElementById('score-guiding-sentence');
  if (sentenceEl) {
    var msg = '';
    if (gapCount === 1) {
      msg = 'Sudah cukup kuat \u2014 hanya ada 1 hal kecil yang perlu diperbaiki';
    } else if (gapCount >= 2 && gapCount <= 3) {
      msg = 'Sudah cukup kuat \u2014 masih ada ' + gapCount + ' hal yang bikin HR ragu';
    } else if (gapCount > 3) {
      msg = 'Masih ada beberapa hal penting yang perlu diperbaiki agar peluang naik';
    }
    if (msg) {
      sentenceEl.textContent = msg;
      sentenceEl.classList.remove('hidden');
    }
  }

  // 4. Show micro-conversion line only when reco section is visible
  var recoSection = document.getElementById('reco-section');
  var microLine   = document.getElementById('micro-conversion-line');
  if (microLine && recoSection && !recoSection.classList.contains('hidden')) {
    microLine.classList.remove('hidden');
  }

  // 5. Smooth-scroll collapsible into view when opened
  var detailsEl = document.getElementById('detail-analysis');
  if (detailsEl) {
    detailsEl.addEventListener('toggle', function () {
      if (detailsEl.open) {
        setTimeout(function () {
          detailsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      }
    });
  }
});
