// ── Module: download-generation.js ───────────────────────────────────────────
// CV generation orchestration: /get-session → /generate → download UI.
// Depends on: all shared state vars + helpers from download-state.js,
// showState/showSessionError/setProgress/setGeneratingText/showDownloadReady
//   from download-ui.js,
// showPostDownloadActions from download-post-download.js,
// stopSessionHeartbeat from download-api.js (hoisted — defined earlier).

// ── fetchAndGenerateCV ────────────────────────────────────────────────────────
// Step 1 of CV generation: validates the session via POST /get-session,
// then hands off to generateCVContent.
async function fetchAndGenerateCV(sessionId) {
  showState('generating-cv');
  setProgress(10);
  setGeneratingText('Mengambil data CV...');
  if (window.Analytics) Analytics.track('cv_generation_started', {
    tier: sessionStorage.getItem('gaslamar_tier') || undefined,
  });

  const controller = new AbortController();
  const timeout    = setTimeout(function() { controller.abort(); }, 25000);

  try {
    const res = await fetch(WORKER_URL + '/get-session', {
      method:      'POST',
      headers:     Object.assign({ 'Content-Type': 'application/json' }, getSecretHeaders()),
      credentials: 'include',
      signal:      controller.signal,
    });

    clearTimeout(timeout);

    if (res.status === 401) {
      showSessionError(
        'Sesi Tidak Ditemukan',
        'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies, lalu coba refresh halaman ini.',
        false
      );
      return;
    }

    if (res.status === 403) {
      showSessionError('Akses Ditolak', 'Pembayaran belum dikonfirmasi atau sesi tidak valid.', false);
      return;
    }

    if (res.status === 404) {
      clearClientSessionData(sessionId);
      const errData  = await res.json().catch(function() { return {}; });
      const tier     = sessionStorage.getItem('gaslamar_tier') || '';
      const validity = (tier === '3pack' || tier === 'jobhunt') ? '30 hari' : '7 hari';
      const msg      = errData.reason === 'expired'
        ? '\u23F0 Sesi kamu sudah berakhir setelah ' + validity + '. Silakan upload ulang CV untuk analisis baru.'
        : 'Sesi tidak ditemukan atau sudah berakhir. Upload ulang CV untuk analisis baru.';
      showSessionError('Sesi Berakhir', msg, false);
      return;
    }

    if (!res.ok) throw new Error('Server error: ' + res.status);

    const sessionData = await res.json();
    const { tier }    = sessionData;
    syncTierFromServer(tier); // overwrites client-stored tier; warns on mismatch

    setProgress(25);
    setGeneratingText('AI sedang menulis CV Bahasa Indonesia...');

    await generateCVContent(sessionId, tier);

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      showSessionError('Timeout', 'Koneksi timeout. Coba refresh halaman ini.');
    } else {
      showSessionError('Terjadi Kesalahan', err.message || 'Gagal memproses CV. Coba refresh halaman.');
    }
  }
}

// ── generateCVContent ─────────────────────────────────────────────────────────
// Step 2: calls POST /generate (session ID travels via cookie), then
// populates cvDataCache and transitions to the download-ready state.
// Also responsible for calling showPostDownloadActions after the UI is ready.
async function generateCVContent(sessionId, tier, newJobDesc) {
  const isBilingual = tier !== 'coba';

  const controller = new AbortController();
  const timeout    = setTimeout(function() { controller.abort(); }, 60000);

  try {
    setProgress(40);
    setGeneratingText('AI sedang menulis CV kamu...');

    // Session ID comes from the HttpOnly cookie — only optional fields go in body
    const reqBody = {};
    if (newJobDesc) reqBody.job_desc = newJobDesc;

    // Pass score/gaps/primary_issue so the worker can send a post-generate email.
    // Reads gaslamar_score_summary written by scoring.js (the full scoring blob is
    // deleted immediately after rendering on hasil.html for security).
    try {
      const summary = JSON.parse(sessionStorage.getItem('gaslamar_score_summary') || '{}');
      sessionStorage.removeItem('gaslamar_score_summary');
      if (typeof summary.skor === 'number')                       reqBody.score         = summary.skor;
      if (Array.isArray(summary.gap) && summary.gap.length)       reqBody.gaps          = summary.gap.slice(0, 3);
      if (summary.primary_issue)                                  reqBody.primary_issue = summary.primary_issue;
      if (typeof summary.preview_before === 'string' && summary.preview_before) reqBody.preview_sample = summary.preview_before;
      if (typeof summary.preview_after  === 'string' && summary.preview_after)  reqBody.preview_after  = summary.preview_after;
    } catch (_) { /* ignore malformed sessionStorage */ }

    const res = await fetch(WORKER_URL + '/generate', {
      method:      'POST',
      headers:     Object.assign({ 'Content-Type': 'application/json' }, getSecretHeaders()),
      credentials: 'include',
      body:        JSON.stringify(reqBody),
      signal:      controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      // Extract a user-facing message from the error body where available
      var serverMsg = 'Gagal generate CV (' + res.status + ')';
      try {
        const errData = await res.json();
        if (errData.message) serverMsg = errData.message;
      } catch (_) {}

      if (res.status === 404) {
        showSessionError(
          'Sesi Tidak Ditemukan',
          'Sesi tidak ditemukan atau sudah berakhir. Sesi berbayar berlaku 7 hari \u2014 ' +
          'jika kamu masih dalam periode ini, coba refresh. ' +
          'Jika sudah lebih dari 7 hari, upload ulang CV untuk analisis baru.',
          false
        );
        return;
      }
      if (res.status === 403) {
        showSessionError('Akses Ditolak', serverMsg, false);
        return;
      }
      // 500 / 429: server resets session to 'paid' so the user can retry
      showSessionError('Gagal Generate CV', serverMsg + ' Klik \u201CCoba Lagi\u201D untuk mencoba ulang.', true);
      return;
    }

    setProgress(75);
    setGeneratingText('Menyiapkan file download...');

    // C6 FIX: Validate Content-Type before calling res.json().
    // If the server returns an HTML error page (e.g. Cloudflare 504), res.json()
    // throws a parse error. Without this check the catch block shows a generic
    // error with no retry guidance, and the session state is left ambiguous.
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      showSessionError('Gagal Generate CV', 'Respons server tidak terduga. Klik “Coba Lagi” untuk mencoba ulang.', true);
      return;
    }

    const { cv_id, cv_en, credits_remaining, total_credits, job_title, company } = await res.json();

    // Cache for retries and for buildCVFilename in download-docx-pdf.js
    cvDataCache = {
      cv_id:         cv_id,
      cv_en:         cv_en,
      tier:          tier,
      total_credits: total_credits,
      job_title:     job_title  != null ? job_title  : null,
      company:       company    != null ? company    : null,
    };

    if (window.Analytics) Analytics.track('cv_generated', {
      tier:              tier,
      is_bilingual:      isBilingual,
      has_english:       !!cv_en,
      credits_remaining: credits_remaining || 0,
    });

    // Clear session storage only when all credits are exhausted
    if (!credits_remaining || credits_remaining <= 0) {
      localStorage.removeItem('gaslamar_session');
      localStorage.removeItem('gaslamar_tier');  // belt-and-suspenders for legacy data
      sessionStorage.removeItem('gaslamar_tier');
    }

    setProgress(90);
    setGeneratingText('Hampir selesai...');

    setTimeout(function() {
      setProgress(100);
      stopSessionHeartbeat(); // CV is ready — no need to keep refreshing the KV TTL
      showDownloadReady(cv_id, cv_en, tier, isBilingual, credits_remaining || 0);
      // Post-download coaching card — called here (not inside showDownloadReady)
      // so the caller controls sequencing after the download UI is rendered.
      showPostDownloadActions(credits_remaining || 0, tier);
    }, 500);

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      showSessionError('Timeout', 'Generate CV timeout. Refresh halaman untuk coba lagi.');
    } else {
      throw err; // re-throw non-timeout errors to the caller's catch
    }
  }
}

// ── showExhaustedResult ───────────────────────────────────────────────────────
// Fallback for users who return to the download page after all credits are
// consumed and the session has been deleted server-side.
// Called by poll() in download-api.js when /get-result returns 200.
// `data` shape: { cv_id, cv_id_docx, cv_en, cv_en_docx, job_title, company, tier, exhausted: true }
async function showExhaustedResult(data) {
  const tier        = data.tier || 'single';
  const isBilingual = tier !== 'coba';

  // Populate cvDataCache so DOCX/PDF helpers (download-docx-pdf.js) can read it
  cvDataCache = {
    cv_id:         data.cv_id         != null ? data.cv_id         : null,
    cv_en:         data.cv_en         != null ? data.cv_en         : null,
    tier:          tier,
    total_credits: null,
    job_title:     data.job_title     != null ? data.job_title     : null,
    company:       data.company       != null ? data.company       : null,
  };

  stopSessionHeartbeat();

  // Transition to download-ready state with 0 credits (exhausted)
  showDownloadReady(data.cv_id, data.cv_en, tier, isBilingual, 0);
  showPostDownloadActions(0, tier);

  // Show a "credits exhausted" banner so the user knows their session is gone
  const bannerContainer = document.getElementById('post-download-actions');
  if (bannerContainer) {
    const banner = document.createElement('div');
    banner.className = 'post-dl-card';
    banner.innerHTML =
      '<div class="post-dl-title">\uD83D\uDCCB CV tersimpan — kredit telah habis</div>' +
      '<p class="post-dl-sub">Sesi kamu sudah berakhir karena semua kredit telah digunakan, ' +
      'tetapi CV terakhir yang dibuat masih bisa diunduh di bawah ini selama 30 hari.</p>';
    bannerContainer.insertBefore(banner, bannerContainer.firstChild);
  }
}

// ── retryGeneration ───────────────────────────────────────────────────────────
// Called by the "Coba Lagi" error button. Reloads if session ID is gone.
async function retryGeneration() {
  if (!sessionIdCache) { window.location.reload(); return; }
  if (window.Analytics) Analytics.track('cv_generation_retry', {
    tier: sessionStorage.getItem('gaslamar_tier') || undefined,
  });
  await fetchAndGenerateCV(sessionIdCache);
}

// ── generateForNewJob ─────────────────────────────────────────────────────────
// Multi-credit flow: validate the session, then generate a CV for a new
// job description entered by the user in #new-job-desc.
async function generateForNewJob() {
  const textarea = document.getElementById('new-job-desc');
  const btn      = document.getElementById('new-job-btn');
  if (!textarea || !btn || !sessionIdCache) return;

  const newJobDesc = textarea.value.trim();
  if (!newJobDesc) { textarea.focus(); return; }
  if (newJobDesc.length > 5000) {
    alert('Job description terlalu panjang (maks 5.000 karakter).');
    return;
  }

  const originalText = btn.textContent;
  btn.disabled    = true;
  btn.textContent = 'Menghubungi server...';

  try {
    // Step 1: call /get-session to transition session to 'generating' status
    const gsRes = await fetch(WORKER_URL + '/get-session', {
      method:      'POST',
      headers:     Object.assign({ 'Content-Type': 'application/json' }, getSecretHeaders()),
      credentials: 'include',
    });

    if (!gsRes.ok) {
      const err = await gsRes.json().catch(function() { return {}; });
      throw new Error(err.message || 'Server error: ' + gsRes.status);
    }

    const { tier } = await gsRes.json();

    // Step 2: hide multi-credit form, transition to generating state
    document.getElementById('multi-credit-section').classList.add('hidden');
    showState('generating-cv');
    setProgress(10);
    setGeneratingText('AI sedang menulis CV untuk loker baru...');

    // Step 3: generate with the new job description
    await generateCVContent(sessionIdCache, tier, newJobDesc);

  } catch (err) {
    btn.disabled    = false;
    btn.textContent = originalText;
    alert(err.message || 'Terjadi kesalahan. Coba lagi.');
  }
}
