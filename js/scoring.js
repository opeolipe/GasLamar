/**
 * scoring.js — GasLamar
 * Displays AI scoring results on hasil.html
 */

(function initScoring() {
  const raw = sessionStorage.getItem('gaslamar_scoring');

  if (!raw) {
    // No data — redirect back
    showError('Data analisis tidak ditemukan. Mohon upload CV kamu kembali.');
    setTimeout(() => window.location.href = 'upload.html', 3000);
    return;
  }

  let scoring;
  try {
    scoring = JSON.parse(raw);
  } catch (e) {
    showError('Data analisis tidak valid. Mohon upload CV kamu kembali.');
    setTimeout(() => window.location.href = 'upload.html', 3000);
    return;
  }

  // Hide loading, show content
  document.getElementById('results-loading').classList.add('hidden');
  document.getElementById('results-content').classList.remove('hidden');

  renderScore(scoring);
  renderStrengths(scoring.kekuatan || []);
  renderGaps(scoring.gap || []);
  renderRecommendations(scoring.rekomendasi || []);
  setupShareButton(scoring.skor || 0);
  setupTierRecommendation(scoring.skor || 0);
})();

function renderScore(scoring) {
  const score = parseInt(scoring.skor) || 0;
  const reason = scoring.alasan_skor || '';

  // Animate number counter
  animateCounter(document.getElementById('score-number'), 0, score, 1200);

  // Announce score to screen readers after animation
  const announce = document.getElementById('score-announce');
  if (announce) {
    setTimeout(() => { announce.textContent = `Skor kamu: ${score} dari 100`; }, 1300);
  }

  // Animate ring
  const ring = document.getElementById('score-ring');
  const circumference = 534; // 2π × 85
  const offset = circumference - (score / 100) * circumference;

  // Set color based on score
  if (score >= 80) {
    ring.classList.add('score-high');
  } else if (score >= 60) {
    ring.classList.add('score-medium');
  } else {
    ring.classList.add('score-low');
  }

  ring.style.setProperty('--target-offset', offset);
  setTimeout(() => {
    ring.style.strokeDashoffset = offset;
  }, 100);

  // Badge
  const badge = document.getElementById('score-badge');
  if (score >= 80) {
    badge.textContent = '🟢 Match Sangat Baik';
    badge.className = 'inline-block px-4 py-1.5 rounded-full text-sm font-bold mb-3 bg-green-100 text-green-700';
  } else if (score >= 60) {
    badge.textContent = '🟡 Match Cukup Baik';
    badge.className = 'inline-block px-4 py-1.5 rounded-full text-sm font-bold mb-3 bg-yellow-100 text-yellow-700';
  } else if (score >= 40) {
    badge.textContent = '🔴 Perlu Improvement';
    badge.className = 'inline-block px-4 py-1.5 rounded-full text-sm font-bold mb-3 bg-red-100 text-red-700';
  } else {
    badge.textContent = '🔴 Gap Kritis';
    badge.className = 'inline-block px-4 py-1.5 rounded-full text-sm font-bold mb-3 bg-red-100 text-red-700';
  }

  // Reason text
  document.getElementById('score-reason').textContent = reason;
}

function renderStrengths(strengths) {
  if (!strengths.length) return;
  document.getElementById('strengths-section').classList.remove('hidden');
  const list = document.getElementById('strengths-list');
  list.innerHTML = strengths.map(s =>
    `<li class="flex items-start gap-3 text-sm text-gray-600">
      <span class="text-accent font-bold mt-0.5 flex-shrink-0">✓</span>
      <span>${escapeHtml(s)}</span>
    </li>`
  ).join('');
}

function renderGaps(gaps) {
  if (!gaps.length) return;
  document.getElementById('gap-section').classList.remove('hidden');
  const list = document.getElementById('gap-list');
  list.innerHTML = gaps.map(g =>
    `<li class="flex items-start gap-3 text-sm text-gray-600">
      <span class="text-danger font-bold mt-0.5 flex-shrink-0">✗</span>
      <span>${escapeHtml(g)}</span>
    </li>`
  ).join('');
}

function renderRecommendations(recos) {
  if (!recos.length) return;
  document.getElementById('reco-section').classList.remove('hidden');
  const list = document.getElementById('reco-list');
  list.innerHTML = recos.map(r =>
    `<li class="flex items-start gap-3 text-sm text-gray-600">
      <span class="text-primary font-bold mt-0.5 flex-shrink-0">→</span>
      <span>${escapeHtml(r)}</span>
    </li>`
  ).join('');
}

function setupShareButton(score) {
  const btn = document.getElementById('share-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const shareText = `Skor CV gue ${score}/100 di GasLamar — AI langsung tunjukin gap-nya vs job description. Coba cek CV kamu juga 👇`;
    const shareUrl = 'https://gaslamar.com';

    if (navigator.share) {
      try {
        await navigator.share({ title: 'GasLamar — Cek Skor CV Kamu', text: shareText, url: shareUrl });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // user cancelled
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      const orig = btn.innerHTML;
      btn.innerHTML = '<span>Tersalin!</span>';
      btn.classList.add('bg-accent', 'border-accent');
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('bg-accent', 'border-accent'); }, 2000);
    } catch (e) {
      // Last fallback: Twitter intent
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText + '\n' + shareUrl)}`, '_blank', 'noopener,noreferrer');
    }
  });
}

function setupTierRecommendation(score) {
  const el = document.getElementById('tier-recommendation');
  if (!el) return;

  let msg, tier;
  if (score < 50) {
    msg = 'Skor kamu di bawah 50 — ada banyak gap yang perlu diperbaiki. <strong>3-Pack lebih hemat</strong> kalau kamu lagi aktif apply ke banyak loker.';
    tier = '3pack';
  } else if (score < 75) {
    msg = 'CV kamu lumayan tapi masih bisa ditingkatkan. <strong>Single</strong> cukup kalau kamu fokus ke satu posisi.';
    tier = 'single';
  } else {
    msg = 'CV kamu sudah cukup kuat! <strong>Single</strong> cukup untuk tailoring ke posisi ini.';
    tier = 'single';
  }

  el.innerHTML = `
    <div class="flex items-start gap-3">
      <span class="text-lg flex-shrink-0">💡</span>
      <p class="text-sm text-blue-900">${msg}
        <button onclick="selectTier('${tier}')" class="ml-1 underline font-semibold hover:no-underline">Pilih sekarang →</button>
      </p>
    </div>`;
  el.classList.remove('hidden');
}

function showError(message) {
  document.getElementById('results-loading').classList.add('hidden');
  document.getElementById('results-error').classList.remove('hidden');
  document.getElementById('error-message').textContent = message;
}

function animateCounter(el, start, end, duration) {
  const startTime = performance.now();
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.round(start + (end - start) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

async function submitEmail() {
  const input = document.getElementById('email-input');
  const btn = document.getElementById('email-submit-btn');
  const status = document.getElementById('email-status');
  if (!input || !btn) return;

  const email = input.value.trim();
  if (!email) { input.focus(); return; }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    if (status) { status.textContent = 'Format email tidak valid.'; status.className = 'text-xs text-red-600 mt-1'; }
    return;
  }

  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const res = await fetch(`${WORKER_URL}/submit-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (res.ok) {
      const form = document.getElementById('email-capture-form');
      if (form) {
        form.innerHTML = '<p class="text-sm text-accent font-semibold">✓ Email tersimpan — kami akan kabari kamu soal fitur baru!</p>';
      }
    } else {
      throw new Error('Server error');
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = orig;
    if (status) { status.textContent = 'Gagal menyimpan. Coba lagi.'; status.className = 'text-xs text-red-600 mt-1'; }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
