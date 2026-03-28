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
})();

function renderScore(scoring) {
  const score = parseInt(scoring.skor) || 0;
  const reason = scoring.alasan_skor || '';

  // Animate number counter
  animateCounter(document.getElementById('score-number'), 0, score, 1200);

  // Animate ring
  const ring = document.getElementById('score-ring');
  const circumference = 327; // 2π × 52
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
