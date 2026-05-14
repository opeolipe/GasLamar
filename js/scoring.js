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
          '⏰ Sesi analisis sudah berakhir (berlaku 2 jam).<br>Silakan upload ulang CV kamu untuk memulai analisis baru.';
      }
      noSessionEl.classList.remove('hidden');
    }
    return;
  }

  // --- Fetch scoring from server ---
  // Scoring is no longer stored as a blob in sessionStorage — only the cv_text_key is kept.
  // This lets the user refresh or open hasil.html in a new tab without losing their results,
  // as long as the 24h cvtext_ TTL has not expired.
  const cvKey = sessionStorage.getItem('gaslamar_cv_key');

  // Always clear legacy blob upfront — prevents stale data from a prior session
  // from being read later in the fallback path if the server fetch succeeds here.
  try { sessionStorage.removeItem('gaslamar_scoring'); } catch (_) {}

  let scoring;

  if (cvKey && cvKey.startsWith('cvtext_')) {
    try {
      const _ac = new AbortController();
      const _at = setTimeout(() => _ac.abort(), 8000);
      const res = await fetch(`${WORKER_URL}/get-scoring?key=${encodeURIComponent(cvKey)}`, { signal: _ac.signal });
      clearTimeout(_at);

      if (res.ok) {
        const data = await res.json();
        if (data.valid && data.scoring) {
          scoring = data.scoring;
        } else {
          // Key expired or not found on server.
          sessionStorage.removeItem('gaslamar_cv_key');
          sessionStorage.removeItem('gaslamar_analyze_time');
          showError('⏰ Sesi analisis sudah berakhir (berlaku 2 jam). Mohon upload ulang CV kamu.');
          setTimeout(() => window.location.href = 'upload.html', 3000);
          return;
        }
      } else if (res.status === 404) {
        sessionStorage.removeItem('gaslamar_cv_key');
        sessionStorage.removeItem('gaslamar_analyze_time');
        showError('⏰ Sesi analisis sudah berakhir (berlaku 2 jam). Mohon upload ulang CV kamu.');
        setTimeout(() => window.location.href = 'upload.html', 3000);
        return;
      }
      // Other server errors → try sessionStorage fallback below
    } catch (_) {
      // Network unavailable or timeout — try sessionStorage fallback
    }
  }

  // Fallback: legacy sessionStorage blob (sessions from before this change, or network failure).
  if (!scoring) {
    const raw = sessionStorage.getItem('gaslamar_scoring');
    if (raw) {
      try {
        scoring = JSON.parse(raw);
        sessionStorage.removeItem('gaslamar_scoring');
      } catch (_) {
        sessionStorage.removeItem('gaslamar_scoring');
      }
    }
  }

  if (!scoring) {
    showError('Data analisis tidak ditemukan. Mohon upload CV kamu kembali.');
    window.location.href = 'upload.html?reason=session_expired';
    return;
  }

  // Store a non-sensitive summary so the download page can forward score/gaps/primary_issue
  // to the post-generate email. The full scoring blob has already been deleted above.
  try {
    const VALID_ISSUES = ['portfolio', 'recruiter_signal', 'north_star', 'effort', 'risk'];
    const skor6d = scoring.skor_6d || {};
    const primary_issue = VALID_ISSUES.reduce(function(a, b) {
      return (skor6d[a] != null ? skor6d[a] : 10) <= (skor6d[b] != null ? skor6d[b] : 10) ? a : b;
    });
    sessionStorage.setItem('gaslamar_score_summary', JSON.stringify({
      skor:           scoring.skor,
      gap:            (scoring.gap || []).slice(0, 3),
      primary_issue:  primary_issue,
      preview_before: scoring.preview_before || undefined,
      preview_after:  scoring.preview_after  || undefined,
    }));
  } catch (_) {}

  // Hide loading, show content
  document.getElementById('results-loading').classList.add('hidden');
  document.getElementById('results-content').classList.remove('hidden');
  renderScoringUpdateBanner();

  renderScore(scoring);
  renderArchetypeAndVerdict(scoring);
  renderStrengths(scoring.kekuatan || []);
  renderRedFlags(scoring.red_flags);
  renderGaps(scoring.gap || []);
  renderHR7Detik(scoring.hr_7_detik);
  renderRecommendations(scoring.rekomendasi || []);
  renderSkor6D(scoring.skor_6d);
  renderBeforeAfter(scoring);
  renderRewritePreview(scoring.rekomendasi || [], scoring.gap || [], scoring.preview_before, scoring.preview_after);
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

  // Scanned PDF advisory
  const scanAdvisory = sessionStorage.getItem('gaslamar_scan_advisory');
  if (scanAdvisory) {
    sessionStorage.removeItem('gaslamar_scan_advisory');
    const advisoryEl = document.createElement('div');
    advisoryEl.style.cssText = 'background:#FEF9C3;border:1px solid #FDE047;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.875rem;color:#713F12;';
    advisoryEl.textContent = '⚠️ CV terdeteksi sebagai PDF scan — akurasi analisis mungkin lebih rendah. Untuk hasil terbaik, gunakan PDF yang dibuat langsung dari aplikasi (bukan hasil scan).';
    const resultsContent = document.getElementById('results-content');
    if (resultsContent) resultsContent.insertBefore(advisoryEl, resultsContent.firstChild);
  }
}

function renderStrengths(strengths) {
  if (!strengths.length) return;
  document.getElementById('strengths-section').classList.remove('hidden');
  const list = document.getElementById('strengths-list');
  list.innerHTML = strengths.map(s =>
    `<li class="flex items-start gap-3 text-sm text-gray-600">
      <span class="text-accent font-bold mt-0.5 flex-shrink-0" aria-hidden="true">✓</span>
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
      <span class="text-danger font-bold mt-0.5 flex-shrink-0" aria-hidden="true">✗</span>
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

function renderRewritePreview(rekomendasi, gap, previewBefore, previewAfter) {
  const section = document.getElementById('rewrite-preview');
  if (!section) return;

  // Need at least 2 items to have something visible + something blurred
  const allItems = [...rekomendasi, ...gap];
  if (allItems.length < 2) return;

  const totalCount = allItems.length;

  // Show actual before/after CV line when the server provided a preview example
  if (previewBefore && previewAfter) {
    document.getElementById('preview-item-1').innerHTML = `
      <div class="preview-item">
        <div class="preview-item-label">✅ Contoh perbaikan nyata dari CV kamu</div>
        <div style="margin-top:6px;font-size:0.8rem;color:#6B7280;margin-bottom:2px;">Sebelum:</div>
        <div class="preview-item-text" style="text-decoration:line-through;opacity:0.6;">${escapeHtml(previewBefore)}</div>
        <div style="margin-top:6px;font-size:0.8rem;color:#059669;margin-bottom:2px;">Sesudah:</div>
        <div class="preview-item-text" style="color:#059669;">${escapeHtml(previewAfter)}</div>
      </div>`;
  } else {
    // Fallback: show first recommendation/gap item
    const first = allItems[0];
    document.getElementById('preview-item-1').innerHTML = `
      <div class="preview-item">
        <div class="preview-item-label">✅ Perbaikan #1 — contoh gratis</div>
        <div class="preview-item-text">${escapeHtml(first)}</div>
      </div>`;
  }

  // Remaining items (up to 4) — blurred
  const rest = allItems.slice(1, 5);
  document.getElementById('preview-items-rest').innerHTML =
    rest.map((item, i) => `
      <div class="preview-item" style="margin-bottom:0.5rem;">
        <div class="preview-item-label">${i + 2 <= rekomendasi.length ? `✅ Perbaikan #${i + 2}` : '❌ Gap yang diperbaiki'}</div>
        <div class="preview-item-text">${escapeHtml(item)}</div>
      </div>`).join('') + `
    <div style="font-size: 0.875rem;color:#6B7280;text-align:center;padding:0.5rem 0 0.25rem;">
      + rewrite lengkap CV dalam Bahasa Indonesia &amp; Inggris
    </div>`;

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
      btn.innerHTML = '<span><span aria-hidden="true">✓</span> Teks skor disalin!</span>';
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
      <span style="font-size:1.1rem;flex-shrink:0;" aria-hidden="true">💡</span>
      <p style="font-size: 0.875rem;color:rgba(255,255,255,0.9);margin:0;">${msg}
        <button id="rec-tier-btn" style="margin-left:4px;text-decoration:underline;font-weight:600;background:none;border:none;color:inherit;cursor:pointer;font-family:inherit;font-size:inherit;padding:0;">Pilih →</button>
      </p>
    </div>`;
  const recBtn = el.querySelector('#rec-tier-btn');
  if (recBtn) recBtn.addEventListener('click', () => selectTier(tier));
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
  // NOTE: "veredict" (with one 'd') is intentional — it matches the backend field name.
  // Do not rename to "verdict" here without a coordinated backend migration.
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
  verdictEl.innerHTML = `<span style="font-size:1rem;" aria-hidden="true">${scoring.veredict === 'DO' ? '✅' : scoring.veredict === 'DO NOT' ? '❌' : '⏳'}</span> <strong>${escapeHtml(cfg.label)}</strong><br><span style="font-weight:400;font-size: 0.875rem;">${escapeHtml(cfg.desc)}</span>`;
  verdictEl.classList.remove('hidden');
  verdictEl.style.display = 'block';
}

function renderSkor6D(skor6d) {
  if (!skor6d || typeof skor6d !== 'object') return;
  const section = document.getElementById('skor-6d-section');
  const bars = document.getElementById('skor-6d-bars');
  if (!section || !bars) return;

  const DIM_LABELS = {
    portfolio:        { label: 'Bukti Nyata di CV',        icon: '📋' },
    recruiter_signal: { label: 'Daya Tarik CV',            icon: '👁️' },
    north_star:       { label: 'Kesesuaian Role',          icon: '🎯' },
    effort:           { label: 'Kemudahan Perbaiki',       icon: '⚡' },
    risk:             { label: 'Skill yang Tetap Dicari',  icon: '🛡️' },
  };

  const bandLabel = val => {
    if (val <= 2) return 'Perlu banyak perbaikan';
    if (val <= 4) return 'Di bawah rata-rata';
    if (val <= 6) return 'Cukup';
    if (val <= 8) return 'Baik';
    return 'Luar biasa';
  };

  bars.innerHTML = Object.entries(DIM_LABELS).map(([key, { label, icon }]) => {
    const val = Math.min(10, Math.max(0, parseInt(skor6d[key]) || 0));
    const pct = val * 10;
    const barColor = val >= 7 ? '#10B981' : val >= 4 ? '#F59E0B' : '#EF4444';
    return `
      <div>
        <div style="display:flex;justify-content:space-between;font-size: 0.875rem;margin-bottom:2px;">
          <span><span aria-hidden="true">${icon}</span> ${escapeHtml(label)}</span>
          <span style="font-weight:600;">${val}/10 — ${escapeHtml(bandLabel(val))}</span>
        </div>
        <div style="background:#E5E7EB;border-radius:4px;height:6px;">
          <div style="width:${pct}%;background:${barColor};border-radius:4px;height:6px;transition:width 0.6s ease;"></div>
        </div>
      </div>`;
  }).join('');

  const scaleLegendId = 'score-scale-legend';
  if (!document.getElementById(scaleLegendId)) {
    const legend = document.createElement('p');
    legend.id = scaleLegendId;
    legend.style.cssText = 'margin-top:10px;font-size:0.8rem;color:#4B5563;';
    legend.textContent = 'Skala: 2 = Perlu banyak perbaikan, 4 = Di bawah rata-rata, 6 = Cukup, 8 = Baik, 10 = Luar biasa.';
    section.appendChild(legend);
  }

  section.classList.remove('hidden');
}

function renderScoringUpdateBanner() {
  const root = document.getElementById('results-content');
  if (!root || document.getElementById('scoring-update-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'scoring-update-banner';
  banner.style.cssText = 'background:#EFF6FF;border:1px solid #93C5FD;color:#1E3A8A;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:0.875rem;';
  banner.textContent = 'Kami telah memperbarui sistem penilaian agar lebih akurat. Skor kamu mungkin berbeda dari sebelumnya.';
  root.insertBefore(banner, root.firstChild);
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
    if (status) { status.textContent = 'Format email tidak valid.'; status.className = 'text-sm text-red-600 mt-1'; }
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
    if (status) { status.textContent = 'Gagal menyimpan. Coba lagi.'; status.className = 'text-sm text-red-600 mt-1'; }
    if (window.Analytics) Analytics.trackError('email_submit', { error_message: e.message });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
