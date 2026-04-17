// ── Module: download-post-download.js ────────────────────────────────────────
// Post-download coaching card and interview tips modal.
// No dependency on shared download-state.js variables.

// ── showPostDownloadActions ───────────────────────────────────────────────────
// Appends a contextual coaching card to #post-download-actions.
// Shows a "use remaining credits" prompt when credits > 0, otherwise an
// upgrade nudge with a tips-modal trigger.
// No-ops silently if the container is absent or if already dismissed.
function showPostDownloadActions(creditsRemaining, tier) {
  const container = document.getElementById('post-download-actions');
  if (!container) return;
  if (sessionStorage.getItem('gaslamar_post_dl_dismissed')) return;

  const card = document.createElement('div');

  if (creditsRemaining > 0) {
    card.className = 'post-dl-card credits-card';
    card.innerHTML =
      '<button class="post-dl-dismiss" aria-label="Tutup notifikasi">\u2715</button>' +
      '<div class="post-dl-title">\uD83C\uDFAF Lamaran pertama sudah siap!</div>' +
      '<p class="post-dl-sub">Kamu masih punya <strong>' + creditsRemaining + ' kredit</strong> tersisa. ' +
      'Tailor CV untuk loker lain \u2014 scroll ke atas dan masukkan job description baru.</p>' +
      '<div class="post-dl-actions">' +
      '<a href="#multi-credit-section" class="btn-next-cv" id="post-dl-next-cv-btn">' +
      '\u270D\uFE0F Siapkan CV Lain</a>' +
      '</div>';
    // Smooth-scroll to multi-credit section instead of anchor hard-jump
    card.querySelector('#post-dl-next-cv-btn').addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.getElementById('multi-credit-section');
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
  } else {
    card.className = 'post-dl-card';
    card.innerHTML =
      '<button class="post-dl-dismiss" aria-label="Tutup notifikasi">\u2715</button>' +
      '<div class="post-dl-title">\uD83D\uDE80 CV kamu sudah siap dikirim!</div>' +
      '<p class="post-dl-sub">Tingkatkan peluang interview dengan persiapan yang matang, ' +
      'atau beli paket hemat untuk loker berikutnya.</p>' +
      '<div class="post-dl-actions">' +
      '<a href="/?tier=3pack" class="btn-buy-pack">\uD83D\uDCE6 Beli Paket Hemat</a>' +
      '<button class="btn-tips" id="tips-trigger-btn">\uD83D\uDCA1 Tips Interview</button>' +
      '</div>';
  }

  card.querySelector('.post-dl-dismiss').addEventListener('click', function() {
    sessionStorage.setItem('gaslamar_post_dl_dismissed', '1');
    container.innerHTML = '';
  });

  container.appendChild(card);

  // Tips trigger is only present in the 0-credit card
  const tipsBtn = document.getElementById('tips-trigger-btn');
  if (tipsBtn) tipsBtn.addEventListener('click', showInterviewTipsModal);
}

// ── showInterviewTipsModal ────────────────────────────────────────────────────
// Creates the tips overlay on first call (lazy DOM construction), then
// un-hides it. Subsequent calls just un-hide the already-created overlay.
function showInterviewTipsModal() {
  let overlay = document.getElementById('tips-modal-overlay');

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'tips-modal-overlay';
    overlay.className = 'tips-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'tips-modal-heading');
    overlay.innerHTML =
      '<div class="tips-modal">' +
        '<button class="tips-modal-close" aria-label="Tutup tips interview" id="tips-modal-close">\u2715</button>' +
        '<div class="tips-modal-title" id="tips-modal-heading">\uD83D\uDCA1 3 Tips Tingkatkan Peluang Interview</div>' +
        '<div class="tip-item"><span class="tip-icon">\uD83D\uDD0D</span>' +
          '<div class="tip-text"><strong>Riset perusahaan 15 menit sebelum interview.</strong> ' +
          'Baca halaman "About", produk utama, dan berita terbaru mereka. ' +
          'Interviewer selalu terkesan dengan kandidat yang tahu konteks bisnis perusahaan.</div></div>' +
        '<div class="tip-item"><span class="tip-icon">\uD83D\uDCD0</span>' +
          '<div class="tip-text"><strong>Gunakan format STAR untuk jawaban behavioural.</strong> ' +
          'Situasi \u2192 Tugas \u2192 Aksi \u2192 Hasil. ' +
          'Siapkan 3\u20135 cerita konkret dari pengalaman kerja atau proyek.</div></div>' +
        '<div class="tip-item"><span class="tip-icon">\u2753</span>' +
          '<div class="tip-text"><strong>Siapkan 2 pertanyaan untuk interviewer.</strong> ' +
          'Contoh: "Seperti apa kesuksesan di 90 hari pertama di posisi ini?" ' +
          'Bertanya menunjukkan kamu serius dan berpikir jangka panjang.</div></div>' +
      '</div>';
    document.body.appendChild(overlay);

    document.getElementById('tips-modal-close').addEventListener('click', closeInterviewTipsModal);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeInterviewTipsModal();
    });

    // One-shot Escape handler — removes itself after first use
    function escHandler(e) {
      if (e.key === 'Escape') {
        closeInterviewTipsModal();
        document.removeEventListener('keydown', escHandler);
      }
    }
    document.addEventListener('keydown', escHandler);
  }

  overlay.classList.remove('hidden');
}

// ── closeInterviewTipsModal ───────────────────────────────────────────────────
// Exposed as a global so download-page.js can wire it to any close trigger.
function closeInterviewTipsModal() {
  const overlay = document.getElementById('tips-modal-overlay');
  if (overlay) overlay.classList.add('hidden');
}
