/**
 * scoring.js — GasLamar
 * Displays AI scoring results on hasil.html
 */

(async function initScoring() {
  // --- Guard flag check (must be first) ---
  // hasil-guard.js sets window.__gaslamarNoSession instead of redirecting when
  // session data is missing or expired — lets us show an inline message here
  // rather than a silent redirect that confuses users.
  if (window.__gaslamarNoSession) {
    const noSessionEl = document.getElementById('no-session-state');
    const loadingEl   = document.getElementById('results-loading');
    if (loadingEl)   loadingEl.classList.add('hidden');
    if (noSessionEl) {
      if (window.__gaslamarNoSession === 'expired') {
        const msgEl = document.getElementById('no-session-msg');
        if (msgEl) msgEl.innerHTML =
          'Sesi analisis sudah kadaluarsa (2 jam).<br>Silakan upload CV kamu kembali untuk memulai analisis baru.';
      }
      noSessionEl.classList.remove('hidden');
    }
    return;
  }

  // --- Server-side session validation (defense-in-depth) ---
  // hasil-guard.js already validated format + timing client-side.
  // We also check the server so a replayed/expired cvtext_ key is caught.
  const cvKey = sessionStorage.getItem('gaslamar_cv_key');
  if (cvKey && cvKey.startsWith('cvtext_')) {
    try {
      const res = await fetch(`${WORKER_URL}/validate-session?cvKey=${encodeURIComponent(cvKey)}`);
      if (res.ok) {
        const data = await res.json();
        if (!data.valid) {
          // Key not found on server — session expired or tampered.
          showError('Sesi analisis sudah kedaluwarsa. Mohon upload CV kamu kembali.');
          sessionStorage.removeItem('gaslamar_scoring');
          sessionStorage.removeItem('gaslamar_cv_key');
          setTimeout(() => window.location.href = 'upload.html', 3000);
          return;
        }
      }
      // Network/server error → fail open, continue rendering
    } catch (_) {
      // Network unavailable — fail open
    }
  }

  const raw = sessionStorage.getItem('gaslamar_scoring');
  // Remove immediately — scoring lives in JS memory only, not in sessionStorage.
  // This prevents browser extensions and devtools from reading the analysis data
  // at rest. hasil-guard.js already validated it exists before we get here.
  sessionStorage.removeItem('gaslamar_scoring');

  if (!raw) {
    // No data — redirect back
    showError('Data analisis tidak ditemukan. Mohon upload CV kamu kembali.');
    window.location.href = 'upload.html?reason=session_expired';
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
  renderArchetypeAndVerdict(scoring);
  renderStrengths(scoring.kekuatan || []);
  renderRedFlags(scoring.red_flags);
  renderGaps(scoring.gap || []);
  renderHR7Detik(scoring.hr_7_detik);
  renderRecommendations(scoring.rekomendasi || []);
  renderSkor6D(scoring.skor_6d);
  renderBeforeAfter(scoring);
  renderRewritePreview(scoring.rekomendasi || [], scoring.gap || []);
  setupShareButton(scoring.skor || 0);
  setupTierRecommendation(scoring.skor || 0);

  // Signal to hasil.html inline scripts that rendering is complete.
  // window.load fires before async rendering finishes, so downstream
  // DOM manipulations (truncation, micro-copy, scroll wiring) must
  // wait for this event instead.
  window.dispatchEvent(new CustomEvent('gaslamar:scored', { detail: { skor: scoring.skor || 0 } }));
})();

function renderScore(scoring) {
  const score = parseInt(scoring.skor) || 0;
  const reason = scoring.alasan_skor || '';

  // Set score immediately — no counter animation.
  // Animating from 0 → score over 1200ms causes intermediate values (e.g. 66)
  // to be visible; any user action during that window makes the score appear to
  // change, which breaks trust in the scoring system.
  const scoreEl = document.getElementById('score-number');
  if (scoreEl) scoreEl.textContent = score;

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
  if (score > 70) {
    ring.classList.add('score-high');
  } else if (score >= 50) {
    ring.classList.add('score-medium');
  } else {
    ring.classList.add('score-low');
  }

  ring.style.setProperty('--target-offset', offset);
  setTimeout(() => {
    ring.style.strokeDashoffset = offset;
  }, 100);

  // Analytics
  if (window.Analytics) {
    sessionStorage.setItem('gaslamar_score_displayed_at', String(Date.now()));
    Analytics.track('score_displayed', {
      score,
      score_bucket: score >= 70 ? 'high' : score >= 50 ? 'medium' : 'low',
      has_jd: sessionStorage.getItem('gaslamar_had_jd') === '1',
      gap_count: (scoring.gap || []).length,
    });
  }

  // Badge
  const badge = document.getElementById('score-badge');
  if (score > 70) {
    badge.textContent = '🟢 Peluang Interview Tinggi';
    badge.className = 'inline-block px-4 py-1.5 rounded-full text-sm font-bold mb-3 bg-green-100 text-green-700';
  } else if (score >= 50) {
    badge.textContent = '🟡 Peluang Interview Sedang';
    badge.className = 'inline-block px-4 py-1.5 rounded-full text-sm font-bold mb-3 bg-yellow-100 text-yellow-700';
  } else {
    badge.textContent = '🔴 Peluang Interview Rendah';
    badge.className = 'inline-block px-4 py-1.5 rounded-full text-sm font-bold mb-3 bg-red-100 text-red-700';
  }

  // Reason text
  document.getElementById('score-reason').textContent = reason;

  // Confidence badge
  const confEl = document.getElementById('confidence-badge');
  if (confEl && scoring.konfidensitas) {
    const COLOR = {Tinggi:'#059669',Sedang:'#92400E',Rendah:'#B91C1C'};
    const BG    = {Tinggi:'#F0FDF4',Sedang:'#FFFBEB',Rendah:'#FEF2F2'};
    confEl.style.color = COLOR[scoring.konfidensitas] || '#6B7280';
    confEl.style.background = BG[scoring.konfidensitas] || '#F9FAFB';
    confEl.textContent = `Konfidensitas analisis: ${scoring.konfidensitas}`;
    confEl.classList.remove('hidden');
  }
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

function renderRedFlags(redFlags) {
  if (!redFlags || !redFlags.length) return;
  const section = document.getElementById('red-flags');
  const list = document.getElementById('red-flags-list');
  if (!section || !list) return;
  list.innerHTML = redFlags.map(f => `<li>🚩 ${escapeHtml(f)}</li>`).join('');
  section.classList.remove('hidden');
}

function renderHR7Detik(hr7) {
  if (!hr7 || (!hr7.kuat?.length && !hr7.diabaikan?.length)) return;
  const section = document.getElementById('hr-7-detik');
  if (!section) return;
  const kuat = document.getElementById('hr-kuat-list');
  const diabaikan = document.getElementById('hr-diabaikan-list');
  if (kuat) kuat.innerHTML = (hr7.kuat || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
  if (diabaikan) diabaikan.innerHTML = (hr7.diabaikan || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
  section.classList.remove('hidden');
}

function renderBeforeAfter(scoring) {
  if (!scoring.skor_sesudah) return;
  const section = document.getElementById('before-after');
  if (!section) return;
  document.getElementById('before-score').textContent = `${scoring.skor}%`;
  document.getElementById('after-score').textContent  = `${scoring.skor_sesudah}%`;
  section.classList.remove('hidden');
}

function renderRewritePreview(rekomendasi, gap) {
  const section = document.getElementById('rewrite-preview');
  if (!section) return;

  // Need at least 2 items to have something visible + something blurred
  const allItems = [...rekomendasi, ...gap];
  if (allItems.length < 2) return;

  const totalCount = allItems.length;

  // First item — fully visible
  const first = allItems[0];
  document.getElementById('preview-item-1').innerHTML = `
    <div class="preview-item">
      <div class="preview-item-label">✅ Perbaikan #1 — contoh gratis</div>
      <div class="preview-item-text">${escapeHtml(first)}</div>
    </div>`;

  // Remaining items (up to 4) — blurred
  const rest = allItems.slice(1, 5);
  document.getElementById('preview-items-rest').innerHTML =
    rest.map((item, i) => `
      <div class="preview-item" style="margin-bottom:0.5rem;">
        <div class="preview-item-label">${i + 2 <= rekomendasi.length ? `✅ Perbaikan #${i + 2}` : '❌ Gap yang diperbaiki'}</div>
        <div class="preview-item-text">${escapeHtml(item)}</div>
      </div>`).join('') + `
    <div style="font-size:0.8rem;color:#6B7280;text-align:center;padding:0.5rem 0 0.25rem;">
      + rewrite lengkap CV dalam Bahasa Indonesia &amp; Inggris
    </div>`;

  document.getElementById('preview-lock-text').textContent =
    `🔒 Lihat semua ${totalCount} perbaikan + CV rewrite lengkap (ID &amp; EN) setelah pilih paket`;
  document.getElementById('preview-lock-text').innerHTML =
    `🔒 Lihat semua ${totalCount} perbaikan + CV rewrite lengkap (ID &amp; EN) setelah pilih paket`;

  section.classList.remove('hidden');
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
      btn.innerHTML = '<span>✓ Teks skor disalin!</span>';
      btn.classList.add('bg-accent', 'border-accent');
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('bg-accent', 'border-accent'); }, 2500);
    } catch (e) {
      // Last fallback: Twitter/X intent
      window.open(`https://x.com/intent/post?text=${encodeURIComponent(shareText + '\n' + shareUrl)}`, '_blank', 'noopener,noreferrer');
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
    <div style="display:flex;align-items:flex-start;gap:0.75rem;">
      <span style="font-size:1.1rem;flex-shrink:0;">💡</span>
      <p style="font-size:0.85rem;color:rgba(255,255,255,0.9);margin:0;">${msg}
        <button onclick="selectTier('${tier}')" style="margin-left:4px;text-decoration:underline;font-weight:600;background:none;border:none;color:inherit;cursor:pointer;font-family:inherit;font-size:inherit;padding:0;">Pilih →</button>
      </p>
    </div>`;
  el.classList.remove('hidden');
}

function renderArchetypeAndVerdict(scoring) {
  // Archetype badge
  const archetypeEl = document.getElementById('archetype-badge');
  if (archetypeEl && scoring.archetype) {
    archetypeEl.textContent = scoring.archetype;
    archetypeEl.style.display = 'inline-block';
    archetypeEl.classList.remove('hidden');
  }

  // Verdict card
  const verdictEl = document.getElementById('verdict-card');
  if (!verdictEl || !scoring.veredict) return;

  const VERDICT_CONFIG = {
    'DO': {
      bg: '#F0FDF4', color: '#15803D', border: '#86EFAC',
      label: 'Layak Dilamar (DO)',
      desc: 'CV kamu cukup kuat untuk posisi ini. Gas lamar sekarang!',
    },
    'DO NOT': {
      bg: '#FEF2F2', color: '#B91C1C', border: '#FCA5A5',
      label: 'Belum Direkomendasikan (DO NOT)',
      desc: 'Gap terlalu besar untuk posisi ini. Perbaiki dulu atau cari posisi yang lebih sesuai.',
    },
    'TIMED': {
      bg: '#FFFBEB', color: '#92400E', border: '#FCD34D',
      label: 'Perlu Persiapan (TIMED)',
      desc: scoring.timebox_weeks
        ? `Bisa dilamar setelah ${scoring.timebox_weeks} minggu persiapan — perbaiki gap di bawah ini.`
        : 'Ada gap signifikan tapi bisa diperbaiki. Fokus pada rekomendasi di bawah.',
    },
  };

  const cfg = VERDICT_CONFIG[scoring.veredict];
  if (!cfg) return;

  verdictEl.style.background = cfg.bg;
  verdictEl.style.color = cfg.color;
  verdictEl.style.border = `1.5px solid ${cfg.border}`;
  verdictEl.innerHTML = `<span style="font-size:1rem;">${scoring.veredict === 'DO' ? '✅' : scoring.veredict === 'DO NOT' ? '❌' : '⏳'}</span> <strong>${escapeHtml(cfg.label)}</strong><br><span style="font-weight:400;font-size:0.8rem;">${escapeHtml(cfg.desc)}</span>`;
  verdictEl.classList.remove('hidden');
  verdictEl.style.display = 'block';
}

function renderSkor6D(skor6d) {
  if (!skor6d || typeof skor6d !== 'object') return;
  const section = document.getElementById('skor-6d-section');
  const bars = document.getElementById('skor-6d-bars');
  if (!section || !bars) return;

  const DIM_LABELS = {
    north_star:       { label: 'Kesesuaian Role', icon: '🎯' },
    recruiter_signal: { label: 'Daya Tarik CV',   icon: '👁️' },
    effort:           { label: 'Kemudahan Perbaiki', icon: '⚡' },
    opportunity_cost: { label: 'Biaya Perbaikan', icon: '💰' },
    risk:             { label: 'Relevansi Jangka Panjang', icon: '🛡️' },
    portfolio:        { label: 'Bukti Nyata di CV', icon: '📋' },
  };

  bars.innerHTML = Object.entries(DIM_LABELS).map(([key, { label, icon }]) => {
    const val = Math.min(10, Math.max(0, parseInt(skor6d[key]) || 0));
    const pct = val * 10;
    const barColor = val >= 7 ? '#10B981' : val >= 4 ? '#F59E0B' : '#EF4444';
    return `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:2px;">
          <span>${icon} ${escapeHtml(label)}</span>
          <span style="font-weight:600;">${val}/10</span>
        </div>
        <div style="background:#E5E7EB;border-radius:4px;height:6px;">
          <div style="width:${pct}%;background:${barColor};border-radius:4px;height:6px;transition:width 0.6s ease;"></div>
        </div>
      </div>`;
  }).join('');

  section.classList.remove('hidden');
}

function showError(message) {
  document.getElementById('results-loading').classList.add('hidden');
  document.getElementById('results-error').classList.remove('hidden');
  document.getElementById('error-message').textContent = message;
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

  if (window.Analytics) {
    Analytics.identify(email, { source: 'score_email_capture' });
    Analytics.track('email_captured', { source: 'score_page' });
  }

  try {
    const res = await fetch(`${WORKER_URL}/submit-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (res.ok) {
      if (window.Analytics) Analytics.track('email_submit_success', { source: 'score_page' });
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
    if (window.Analytics) Analytics.trackError('email_submit', { error_message: e.message });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
