import { jsonResponse } from '../cors.js';
import { clientIp, log, logError, extractJobMetadata } from '../utils.js';
import { checkRateLimit, rateLimitResponse } from '../rateLimit.js';
import { getSession, updateSession, verifySessionSecret } from '../sessions.js';
import { SESSION_STATES } from '../sessionStates.js';
import { tailorCVID, tailorCVEN } from '../tailoring.js';
import { KV_CV_RESULT_PREFIX } from '../constants.js';
import { sendCVReadyEmail } from '../email.js';
import { getSessionIdFromCookie } from '../cookies.js';
import { getRoleProfile } from '../roleProfiles.js';
import { isJDQualityHigh } from '../pipeline/roleInference.js';
import { generateInterviewKit } from './interviewKit.js';
import { hasPromptInjection, sanitizeForLLM } from '../sanitize.js';

export async function handleGenerate(request, env, ctx) {
  const ip = clientIp(request);

  const allowed = await checkRateLimit(env, env.RATE_LIMITER_GENERATE, ip);
  if (!allowed) {
    return rateLimitResponse(request, env);
  }

  // Session ID comes from the HttpOnly cookie — not the request body.
  const session_id = getSessionIdFromCookie(request);
  if (!session_id) {
    return jsonResponse({ message: 'Sesi tidak ditemukan. Pastikan browser mengizinkan cookies.' }, 401, request, env);
  }

  // Body still carries optional per-request fields (job_desc override, analytics data)
  let body;
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }

  const { job_desc: newJobDesc } = body;

  // Optional preview consistency fields — lightweight strings, validated below
  const rawPrimaryIssue   = body.primary_issue;
  const rawPreviewSample  = body.preview_sample;
  const rawPreviewAfter   = body.preview_after;

  const VALID_ISSUES = new Set(['portfolio', 'recruiter_signal', 'north_star', 'effort', 'risk']);
  const primaryIssue  = typeof rawPrimaryIssue  === 'string' && VALID_ISSUES.has(rawPrimaryIssue)  ? rawPrimaryIssue  : null;

  // previewSample and previewAfter are user-controlled strings embedded verbatim into
  // the tailored CV text. Strip HTML tags and entities in addition to injection patterns
  // to prevent markup or script content from surviving into the generated document.
  const stripHtml = s => s.replace(/<[^>]*>/g, '').replace(/&[a-zA-Z0-9#]{1,8};/g, '');
  let previewSample = null;
  if (typeof rawPreviewSample === 'string' && rawPreviewSample.length <= 500) {
    if (hasPromptInjection(rawPreviewSample)) {
      return jsonResponse({ message: 'Konten tidak valid' }, 400, request, env);
    }
    previewSample = sanitizeForLLM(stripHtml(rawPreviewSample));
  }
  let previewAfter = null;
  if (typeof rawPreviewAfter === 'string' && rawPreviewAfter.length <= 500) {
    if (hasPromptInjection(rawPreviewAfter)) {
      return jsonResponse({ message: 'Konten tidak valid' }, 400, request, env);
    }
    previewAfter = sanitizeForLLM(stripHtml(rawPreviewAfter));
  }

  // Optional entitas_klaim whitelist — claims already present in user's own CV
  const rawKlaim = body.entitas_klaim;
  let entitasKlaim = null;
  if (rawKlaim !== undefined) {
    if (!Array.isArray(rawKlaim) || rawKlaim.length > 20 ||
        rawKlaim.some(k => typeof k !== 'string' || k.length > 100)) {
      return jsonResponse({ message: 'Entitas klaim tidak valid' }, 400, request, env);
    }
    // Normalize: deduplicate, lowercase, trim, drop empty strings.
    // M9 FIX: Threshold lowered from > 2 to >= 1 to match rewriteGuard.js allowedTerms —
    // short language names like R, Go, C# are legitimate and must survive to the guard.
    entitasKlaim = [...new Set(rawKlaim.map(k => k.trim().toLowerCase()).filter(k => k.length >= 1))];
  }
  // Optional angka_di_cv — numbers found in CV (forwarded from /analyze response)
  // Used to anchor the ground-truth block in the tailor prompt.
  const rawAngkaDiCv = body.angka_di_cv;
  let angkaDiCv = null;
  if (rawAngkaDiCv !== undefined) {
    if (typeof rawAngkaDiCv !== 'string' || rawAngkaDiCv.length > 400) {
      return jsonResponse({ message: 'angka_di_cv tidak valid' }, 400, request, env);
    }
    // H4 FIX: angka_di_cv is a user-controlled string injected into the tailor prompt.
    if (hasPromptInjection(rawAngkaDiCv)) {
      return jsonResponse({ message: 'Konten tidak valid' }, 400, request, env);
    }
    angkaDiCv = sanitizeForLLM(rawAngkaDiCv.trim()) || null;
  }

  // score and gaps are optional analytics fields forwarded to the CV-ready email.
  // Validate before use: score must be a finite number 0–100; gaps must be an
  // array of short strings. Reject the entire request if types are wrong.
  const rawScore = body.score;
  const rawGaps  = body.gaps;
  if (rawScore !== undefined) {
    const n = Number(rawScore);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return jsonResponse({ message: 'Score tidak valid' }, 400, request, env);
    }
  }
  if (rawGaps !== undefined) {
    if (!Array.isArray(rawGaps) || rawGaps.length > 10 || rawGaps.some(g => typeof g !== 'string' || g.length > 500)) {
      return jsonResponse({ message: 'Gaps tidak valid' }, 400, request, env);
    }
  }
  const score = rawScore !== undefined ? Number(rawScore) : undefined;
  const gaps  = rawGaps;

  // Optional new job_desc for multi-credit re-use (3-Pack / JobHunt)
  if (newJobDesc !== undefined) {
    if (typeof newJobDesc !== 'string' || newJobDesc.length > 5000) {
      return jsonResponse({ message: 'Job description terlalu panjang (maks 5.000 karakter)' }, 400, request, env);
    }
    // Non-empty overrides must satisfy the same 100-char floor as /analyze.
    // Empty string is treated as "no override" (falls back to stored job_desc), so skip the check.
    if (newJobDesc.trim().length > 0 && newJobDesc.trim().length < 100) {
      return jsonResponse({ message: 'Job description pengganti terlalu pendek. Minimal 100 karakter.' }, 400, request, env);
    }
    // Apply the same injection checks as /analyze — newJobDesc is user-supplied and injected into tailor prompts.
    if (newJobDesc.trim().length > 0 && hasPromptInjection(newJobDesc)) {
      return jsonResponse({ message: 'Konten tidak valid' }, 400, request, env);
    }
  }

  // Verify session exists and has status 'generating' (set by /get-session)
  // All CV data comes from KV — browser cannot inject arbitrary content
  const session = await getSession(env, session_id);
  if (!session) {
    return jsonResponse({ message: 'Sesi tidak ditemukan atau sudah kedaluwarsa' }, 404, request, env);
  }

  // Verify session secret (new sessions require it; legacy sessions without hash skip this check)
  const providedSecret = request.headers.get('X-Session-Secret');
  if (!await verifySessionSecret(session, providedSecret)) {
    return jsonResponse({ message: 'Akses ditolak: token sesi tidak valid' }, 403, request, env);
  }

  if (session.status !== 'generating') {
    return jsonResponse({ message: 'Sesi tidak valid atau pembayaran belum dikonfirmasi' }, 403, request, env);
  }

  const { cv_text, job_desc: storedJobDesc, tier, inferred_role: inferredRole } = session;
  const effectiveJobDesc = (newJobDesc && newJobDesc.trim())
    ? sanitizeForLLM(newJobDesc.trim())
    : storedJobDesc;

  if (!cv_text || !effectiveJobDesc || !tier) {
    return jsonResponse({ message: 'Data sesi tidak lengkap' }, 400, request, env);
  }

  // Credits: legacy sessions without the field get 1 (they paid for single use)
  const creditsRemaining = typeof session.credits_remaining === 'number' ? session.credits_remaining : 1;
  const isBilingual = tier !== 'coba';

  // Role-aware tailoring mode:
  //   'targeted'  — JD is rich enough; role profile not injected into prompt.
  //   'inferred'  — JD is weak; role profile guides bullet emphasis and action verbs.
  // We only inject the profile when confidence is available (session carries inferred_role).
  const jdMode      = isJDQualityHigh(effectiveJobDesc) ? 'targeted' : 'inferred';
  const roleProfile = jdMode === 'inferred' ? getRoleProfile(inferredRole) : null;

  // Session lock — prevent double-generation race condition
  const lockKey = `lock_${session_id}`;
  const existingLock = await env.GASLAMAR_SESSIONS.get(lockKey);
  if (existingLock) {
    return jsonResponse({ message: 'Sedang diproses, coba lagi sebentar.' }, 409, request, env);
  }
  // H5 FIX: Reduced from 120s to 60s (KV minimum). The Cloudflare Worker wall-clock
  // limit is 30s, so a 120s lock would block retries for 90 extra seconds after a
  // Worker timeout. 60s reduces that window to 30 extra seconds and satisfies the
  // KV minimum TTL requirement.
  await env.GASLAMAR_SESSIONS.put(lockKey, 'locked', { expirationTtl: 60 });

  try {
    // Generate from KV data only — never from request body (except allowed job_desc override).
    // Run ID and EN tailoring in parallel to stay within Cloudflare's 30s wall-clock limit.
    // Sequential calls could reach 50s (2 × 25s Claude timeout) and hard-kill the Worker.
    const extractedCV = (angkaDiCv || entitasKlaim)
      ? { angka_di_cv: angkaDiCv ?? 'NOL ANGKA', entitas_klaim: entitasKlaim ?? [], skills_mentah: '' }
      : null;

    const tailorOpts = { issue: primaryIssue, previewSample, previewAfter, entitasKlaim, roleProfile, jdMode, extractedCV };

    // Pre-generate interview kit in parallel with CV tailoring.
    // Cache it under kit_${session_id}_id so /interview-kit can serve it
    // immediately (even after the session is deleted for single-credit users).
    const kitPromise = generateInterviewKit(cv_text, effectiveJobDesc, 'id', env)
      .then(kit => {
        const entry = { kit, session_secret_hash: session.session_secret_hash ?? null };
        return env.GASLAMAR_SESSIONS.put(`kit_${session_id}_id`, JSON.stringify(entry), { expirationTtl: 86400 }).then(() => kit);
      })
      .catch(() => null);

    let idResult, enResult;
    if (isBilingual) {
      [idResult, enResult] = await Promise.all([
        tailorCVID(cv_text, effectiveJobDesc, env, 'pdf', tailorOpts),
        tailorCVEN(cv_text, effectiveJobDesc, env, 'pdf', tailorOpts),
      ]);
    } else {
      idResult = await tailorCVID(cv_text, effectiveJobDesc, env, 'pdf', tailorOpts);
      enResult = null;
    }

    // Wait for kit to finish (it ran in parallel, should already be done)
    const interviewKitId = await kitPromise;

    const isTrusted = idResult.isTrusted && (enResult ? enResult.isTrusted : true);

    const newCreditsRemaining = creditsRemaining - 1;

    // Persist last generated CV so the user can re-download after session is deleted.
    // TTL mirrors the session: 7 days for single-credit, 30 days for multi-credit.
    const resultTtl = (session.total_credits ?? 1) > 1 ? 2592000 : 604800;
    const { job_title: resultJobTitle, company: resultCompany } = extractJobMetadata(effectiveJobDesc);
    await env.GASLAMAR_SESSIONS.put(
      `${KV_CV_RESULT_PREFIX}${session_id}`,
      JSON.stringify({
        cv_id:      idResult.text,
        cv_id_docx: idResult.docxText,
        cv_en:      enResult?.text      ?? null,
        cv_en_docx: enResult?.docxText  ?? null,
        session_secret_hash: session.session_secret_hash ?? null,
        job_title:  resultJobTitle ?? null,
        company:    resultCompany  ?? null,
        tier,
        saved_at:   Date.now(),
      }),
      { expirationTtl: resultTtl }
    ).catch(e => { logError('cv_result_kv_write_failed', { session_id, error: e?.message }); });

    log('generate_success', { session_id, tier, credits_remaining: newCreditsRemaining });

    if (newCreditsRemaining <= 0) {
      // Last credit consumed — mark exhausted rather than deleting so /check-session
      // returns a meaningful status and the client can distinguish "used up" from "expired".
      // cv_result_ and kit_ KV entries persist under their own TTLs.
      if (ctx && (score !== undefined || gaps !== undefined)) {
        // sendCVReadyEmail reads the session to get the stored email address.
        // Mark exhausted first so the session exists for the email lookup,
        // then fire the email in the background.
        await updateSession(env, session_id, {
          status: SESSION_STATES.EXHAUSTED,
          credits_remaining: 0,
        }).catch(() => {});
        ctx.waitUntil(
          sendCVReadyEmail(session_id, score, gaps, env)
            .catch(e => logError('cv_ready_email_failed', { session_id, error: e.message }))
        );
      } else {
        await updateSession(env, session_id, {
          status: SESSION_STATES.EXHAUSTED,
          credits_remaining: 0,
        }).catch(() => {});
      }
    } else {
      // Credits remain — transition to 'ready' (not 'paid') so the client knows a result exists.
      const updates = { status: SESSION_STATES.READY, credits_remaining: newCreditsRemaining };
      if (newJobDesc && newJobDesc.trim()) updates.job_desc = effectiveJobDesc;
      await updateSession(env, session_id, updates);
      if (ctx && (score !== undefined || gaps !== undefined)) {
        ctx.waitUntil(sendCVReadyEmail(session_id, score, gaps, env).catch(e => {
          logError('cv_ready_email_failed', { session_id, error: e.message });
        }));
      }
    }

    const { job_title, company } = extractJobMetadata(effectiveJobDesc);
    return jsonResponse({
      cv_id:             idResult.text,
      cv_id_docx:        idResult.docxText,
      cv_en:             enResult?.text      ?? null,
      cv_en_docx:        enResult?.docxText  ?? null,
      isTrusted,
      credits_remaining: newCreditsRemaining,
      total_credits:     session.total_credits ?? 1,
      job_title:         job_title      ?? null,
      company:           company        ?? null,
      interview_kit:     interviewKitId ?? null,
    }, 200, request, env);
  } catch (e) {
    // On failure, restore to the state that allows retry without consuming a credit.
    // If a cv_result_ already exists the user has a previous generation — restore to
    // 'ready' so the client knows the result is accessible. Otherwise restore to 'paid'.
    logError('generate_failed', { session_id, error: e.message });
    const hasExistingResult = !!(await env.GASLAMAR_SESSIONS.get(`${KV_CV_RESULT_PREFIX}${session_id}`).catch(() => null));
    const rollbackStatus = hasExistingResult ? SESSION_STATES.READY : SESSION_STATES.PAID;
    await updateSession(env, session_id, { status: rollbackStatus }).catch((e2) => {
      logError('generate_recovery_failed', { session_id, error: e2.message });
    });
    // Only pass through exact messages thrown by tailoring.js — never arbitrary Claude/API errors.
    const USER_FACING_MSGS = new Set([
      'CV terlalu besar untuk diproses. Coba ringkas CV kamu.',
      'CV Bahasa Indonesia kosong dari AI. Coba lagi.',
      'CV is too large to process. Please shorten your CV.',
      'English CV returned empty from AI. Please retry.',
      'Respons AI terpotong. Coba lagi.',
    ]);
    const userMsg = (typeof e.message === 'string' && USER_FACING_MSGS.has(e.message))
      ? e.message
      : 'Generate CV gagal. Coba lagi.';
    return jsonResponse({ message: userMsg }, 500, request, env);
  } finally {
    await env.GASLAMAR_SESSIONS.delete(lockKey).catch(() => {});
  }
}
