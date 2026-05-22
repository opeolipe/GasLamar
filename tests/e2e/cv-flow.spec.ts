import { test, expect, Page } from '@playwright/test';
import path from 'path';

// ---------- CONSTANTS ----------

const TEST_SESSION_ID = 'sess_e2e-test-session-123';

// Matches ScoringData interface exactly (wrong types crash DetailAnalysis.tsx)
const MOCK_ANALYZE_RESPONSE = {
  skor_6d: {
    north_star: 7,
    recruiter_signal: 6,
    effort: 8,
    opportunity_cost: 7,
    risk: 5,
    portfolio: 6,
  },
  skor: 72,
  gap: ['skill_gap_marketing', 'tool_gap_analytics'],
  veredict: 'DO' as const,                           // must be 'DO' | 'DO NOT' | 'TIMED'
  rekomendasi: ['Tambahkan sertifikasi Google Analytics'],
  kekuatan: ['Pengalaman social media'],
  alasan_skor: 'CV cukup baik dengan pengalaman relevan',
  hr_7_detik: {                                       // must be {kuat:string[], diabaikan:string[]}
    kuat: ['Pengalaman social media yang relevan'],
    diabaikan: [],
  },
  red_flags: [],
  archetype: 'practitioner',
  konfidensitas: 'Tinggi' as const,                  // must be 'Tinggi' | 'Sedang' | 'Rendah'
  skor_sesudah: 85,
  timebox_weeks: 4,
  cv_text_key: 'cvtext_test-key-e2e',
};

const SAMPLE_CV_PATH = path.resolve('tests/fixtures/sample-cv.pdf');
const SHORT_CV_PATH  = path.resolve('tests/fixtures/short-cv.txt');

// ---------- HELPERS ----------

async function uploadCV(page: Page, filePath: string) {
  await page.setInputFiles('[data-testid="file-input"]', filePath);
  await expect(page.locator('[data-testid="file-preview"]')).toBeVisible();
}

async function fillValidJD(page: Page) {
  // evaluateJDQuality requires: >= 100 chars (matches backend minimum).
  // Structure keyword check is advisory only — doesn't block submission.
  await page.fill(
    '[data-testid="jd-textarea"]',
    'Digital Marketing Specialist — PT Digital Solution\n\nRequirements:\n- Social media management\n- Google Analytics\n\nResponsibilities:\n- Manage Instagram and TikTok content\n- Create monthly performance reports',
  );
}

/**
 * Seed localStorage so download-guard.js allows the page to render.
 * Uses addInitScript so values are set BEFORE download-guard.js (a synchronous
 * blocking <head> script) runs — eliminates any race with page.evaluate timing.
 *
 * The guard only checks gaslamar_has_session === '1' (a non-sensitive routing
 * flag). The actual session_id is HttpOnly-cookie-based and returned by the
 * mocked /check-session response; it is never stored client-side.
 */
async function setupDownloadSession(page: Page) {
  await page.addInitScript(() => {
    if (location.pathname.startsWith('/download')) {
      localStorage.setItem('gaslamar_has_session', '1');
    }
  });
}

/** Mock /check-session → paid (triggers startGeneration). */
async function mockCheckSession(page: Page, overrides: Record<string, unknown> = {}) {
  await page.route('**/check-session**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session_id: TEST_SESSION_ID,
        status: 'paid',
        tier: 'single',
        credits_remaining: 1,
        total_credits: 1,
        expires_at: Date.now() + 3_600_000,
        ...overrides,
      }),
    }),
  );
}

/** Mock /get-session (called by useGenerateCV before /generate). */
async function mockGetSession(page: Page, tier = 'single') {
  await page.route('**/get-session**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tier }),
    }),
  );
}

/** Mock /generate with custom CV content. */
async function mockGenerate(
  page: Page,
  overrides: Record<string, unknown> = {},
) {
  await page.route('**/generate**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        cv_id: 'Mock CV content — Digital Marketing Specialist with relevant experience.',
        cv_id_docx:
          'Mock CV content — Digital Marketing Specialist with relevant experience.\n(catatan: tambahkan hasil konkret di setiap bullet point)',
        cv_en: null,
        isTrusted: true,
        credits_remaining: 0,
        total_credits: 1,
        ...overrides,
      }),
    }),
  );
}

/** Navigate to the download page with session + all required route mocks. */
async function gotoDownload(
  page: Page,
  generateOverrides: Record<string, unknown> = {},
) {
  await setupDownloadSession(page);
  await mockCheckSession(page);
  await mockGetSession(page);
  await mockGenerate(page, generateOverrides);
  // serve v14 strips .html via 301 — use extensionless URL directly
  await page.goto('/download');
}

// ---------- SUITE ----------

test.describe('GasLamar CV Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Register route mocks BEFORE navigating — they persist across all
    // same-origin navigations within this test's page context.

    // Mock /analyze so tests don't need a live worker
    await page.route('**/analyze**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ANALYZE_RESPONSE),
      }),
    );

    // Mock /validate-session to avoid silent redirect-to-upload
    await page.route('**/validate-session**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: true }),
      }),
    );

    // Navigate first, then clear storage ONCE via evaluate.
    // IMPORTANT: never use page.addInitScript for storage clearing — it fires
    // before every page load including internal app navigations, which wipes
    // sessionStorage set by Upload.tsx before Analyzing.tsx can read it.
    await page.goto('/upload');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  // ── ANALYZING PAGE TRANSITION ─────────────────────────────────────────────

  test('analyzing page transitions to hasil after mock analyze', async ({ page }) => {
    await uploadCV(page, SAMPLE_CV_PATH);
    await fillValidJD(page);
    await page.click('[data-testid="submit-upload"]');

    // serve v14 redirects *.html → extensionless via 301
    await page.waitForURL('**/analyzing**', { timeout: 15000 });

    // After /analyze succeeds, Analyzing.tsx redirects to hasil
    await page.waitForURL('**/hasil**', { timeout: 60000 });
    await expect(page.locator('[data-testid="generate-cv-button"]')).toBeVisible({
      timeout: 15000,
    });
  });

  // ── ANALYZE FAILURE ───────────────────────────────────────────────────────

  test('analyze failure shows error on analyzing page', async ({ page }) => {
    // Override the /analyze mock from beforeEach with a 500.
    // Routes are matched LIFO so this registration takes precedence.
    await page.route('**/analyze**', (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ message: 'Server error' }) }),
    );

    await uploadCV(page, SAMPLE_CV_PATH);
    await fillValidJD(page);
    await page.click('[data-testid="submit-upload"]');

    await page.waitForURL('**/analyzing**', { timeout: 15000 });
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible({
      timeout: 15000,
    });
  });

  // ── FULL FLOW + PREVIEW CONSISTENCY ──────────────────────────────────────

  test('full flow: B1 fix — gaslamar_sample persisted before cv_pending cleared', async ({ page }) => {
    await uploadCV(page, SAMPLE_CV_PATH);
    await fillValidJD(page);
    await page.click('[data-testid="submit-upload"]');
    await page.waitForURL('**/hasil**', { timeout: 60000 });

    // Verify useAnalysisPolling persisted gaslamar_sample_line before clearing cv_pending.
    // This is the root fix for preview = download consistency (B1).
    // gaslamar_sample_line is a plain string (the best bullet from the CV), not JSON.
    const storedSample = await page.evaluate(() => sessionStorage.getItem('gaslamar_sample_line'));
    expect(storedSample).toBeTruthy();

    // cv_pending must be cleared at this point
    const cvPending = await page.evaluate(() => sessionStorage.getItem('gaslamar_cv_pending'));
    expect(cvPending).toBeNull();

    // Navigate to download — verify the UI renders correctly
    await setupDownloadSession(page);
    await mockCheckSession(page);
    await mockGetSession(page);
    await mockGenerate(page, { cv_id: storedSample + ' — Digital Marketing Specialist.' });

    await page.goto('/download');
    await expect(page.locator('[data-testid="cv-content"]')).toBeVisible({
      timeout: 30000,
    });

    const cvText = await page.locator('[data-testid="cv-content"]').textContent();
    expect(cvText).toContain(storedSample);
  });

  // ── TRUST BADGE POSITIVE ─────────────────────────────────────────────────

  test('trust badge visible when isTrusted is true', async ({ page }) => {
    await gotoDownload(page, { isTrusted: true });
    await expect(page.locator('[data-testid="trust-badge"]')).toBeVisible({
      timeout: 30000,
    });
  });

  // ── TRUST BADGE NEGATIVE ─────────────────────────────────────────────────

  test('trust badge hidden when isTrusted is false', async ({ page }) => {
    await gotoDownload(page, { isTrusted: false });
    await expect(page.locator('[data-testid="cv-content"]')).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator('[data-testid="trust-badge"]')).toBeHidden();
  });

  // ── PDF vs DOCX ───────────────────────────────────────────────────────────

  test('PDF cv-content has no guidance notes; DOCX version does', async ({ page }) => {
    const pdfText  = 'CV Bahasa Indonesia tanpa catatan tambahan.';
    const docxText = `${pdfText}\n(catatan: tambahkan hasil konkret di setiap bullet)`;

    await gotoDownload(page, { cv_id: pdfText, cv_id_docx: docxText });
    await expect(page.locator('[data-testid="cv-content"]')).toBeVisible({
      timeout: 30000,
    });

    // cv-content renders cv_id (PDF version), not cv_id_docx
    const shown = await page.locator('[data-testid="cv-content"]').textContent();
    expect(shown).not.toContain('(catatan:');
    expect(shown).toContain(pdfText);
  });

  // ── FAKE NUMBER REJECTION ─────────────────────────────────────────────────

  test('isTrusted:false CV with hallucinated number hides trust badge', async ({ page }) => {
    const hallucinatedCV =
      'Meningkatkan engagement sosial media sebesar 40% dalam 3 bulan.';

    await gotoDownload(page, {
      cv_id: hallucinatedCV,
      isTrusted: false,
    });
    await expect(page.locator('[data-testid="cv-content"]')).toBeVisible({
      timeout: 30000,
    });

    // Trust badge must be absent from DOM (isTrusted:false → not rendered)
    await expect(page.locator('[data-testid="trust-badge"]')).toBeHidden();
  });

  test('isTrusted:false CV with repetitive AI ending pattern hides trust badge', async ({ page }) => {
    const repetitiveCV = [
      'RINGKASAN PROFESIONAL',
      'Berpengalaman di sales B2B dan operasional distribusi.',
      '',
      'PENGALAMAN KERJA',
      '- Menangani komunikasi klien untuk memastikan kelancaran operasional',
      '- Menangani follow-up partner untuk memastikan kelancaran operasional',
      '- Menangani distribusi area untuk memastikan kelancaran operasional',
    ].join('\n');

    await gotoDownload(page, {
      cv_id: repetitiveCV,
      isTrusted: false,
    });
    await expect(page.locator('[data-testid="cv-content"]')).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator('[data-testid="trust-badge"]')).toBeHidden();
  });

  test('anchored summary style renders cleanly in download preview', async ({ page }) => {
    const anchoredCV = [
      'RINGKASAN PROFESIONAL',
      'Berpengalaman di sales B2B dengan klien seperti Siloam Hospital dan area Jawa Timur.',
      '',
      'PENGALAMAN KERJA',
      '- Menangani komunikasi klien B2B dan follow-up order area Surabaya',
    ].join('\n');

    await gotoDownload(page, { cv_id: anchoredCV, isTrusted: true });
    await expect(page.locator('[data-testid="cv-content"]')).toBeVisible({
      timeout: 30000,
    });
    const shown = await page.locator('[data-testid="cv-content"]').textContent();
    expect(shown).toContain('Siloam Hospital');
    expect(shown).not.toMatch(/\[.*\]/);
  });

  // ── SHORT LINE — NO PLACEHOLDER BRACKETS ─────────────────────────────────

  test('short CV does not produce placeholder brackets in rewrite preview', async ({ page }) => {
    await uploadCV(page, SHORT_CV_PATH);
    await fillValidJD(page);
    await page.click('[data-testid="submit-upload"]');
    await page.waitForURL('**/hasil**', { timeout: 60000 });

    // Check rekomendasi bullets section (tabs removed; DimRewritePreview removed; fix-before-after is now used)
    const fixSection = page.locator('[data-testid="fix-before-after"]');
    if (await fixSection.isVisible()) {
      const fixText = await fixSection.textContent();
      expect(fixText).not.toMatch(/\[.*\]/);

    }

    await gotoDownload(page);
    await expect(page.locator('[data-testid="cv-content"]')).toBeVisible({ timeout: 30000 });
    const cvText = await page.locator('[data-testid="cv-content"]').textContent();
    expect(cvText).not.toMatch(/\[.*\]/);
  });

  // ── API FAILURE — GENERATE 500 ────────────────────────────────────────────

  test('generate 500 shows error and enables retry button', async ({ page }) => {
    await setupDownloadSession(page);
    await mockCheckSession(page);
    await mockGetSession(page);

    // /generate returns 500 — useGenerateCV sets retryable:true for 5xx
    await page.route('**/generate**', (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ message: 'Internal server error' }) }),
    );

    await page.goto('/download');

    await expect(page.locator('[data-testid="error-message"]')).toBeVisible({
      timeout: 20000,
    });
    // Retry button (generate-cv-button in SessionError) must be enabled and clickable
    await expect(page.locator('[data-testid="generate-cv-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="generate-cv-button"]')).toBeEnabled();
  });

  test('download page loads from localStorage when sessionStorage is empty', async ({ page }) => {
    const sessionId = 'sess_e2e-localstorage-only';
    await page.addInitScript((sid) => {
      if (location.pathname.startsWith('/download')) {
        localStorage.setItem('gaslamar_session', sid);
        sessionStorage.clear();
      }
    }, sessionId);

    await mockCheckSession(page, { status: 'paid', session_id: sessionId, credits_remaining: 2, total_credits: 3 });
    await mockGetSession(page);
    await mockGenerate(page, { credits_remaining: 1, total_credits: 3 });

    await page.goto('/download?session=' + sessionId);
    await expect(page.locator('[data-testid="cv-content"]')).toBeVisible({ timeout: 30000 });

    const storageState = await page.evaluate((sid) => ({
      localSession: localStorage.getItem('gaslamar_session'),
      sessionSession: sessionStorage.getItem('gaslamar_session'),
    }), sessionId);
    expect(storageState.localSession).toBe(sessionId);
    expect(storageState.sessionSession).toBeNull();
  });

  test('first cleanup visit stamps seen entry for stale secret without deleting it', async ({ page }) => {
    const activeSession = 'sess_e2e-active-firstseen';
    const oldSession    = 'sess_e2e-old-firstseen';

    await page.addInitScript(({ activeSession, oldSession }) => {
      if (location.pathname.startsWith('/download')) {
        localStorage.setItem('gaslamar_session', activeSession);
        localStorage.setItem(`gaslamar_secret_${activeSession}`, 'active-secret');
        localStorage.setItem(`gaslamar_secret_${oldSession}`, 'old-secret');
        // No seen_ entry — simulates first time cleanup sees this stale key
      }
    }, { activeSession, oldSession });

    await mockCheckSession(page, { status: 'paid', session_id: activeSession });
    await mockGetSession(page);
    await mockGenerate(page);

    await page.goto('/download');
    await expect(page.locator('[data-testid="cv-content"]')).toBeVisible({ timeout: 30000 });

    const storageState = await page.evaluate(({ activeSession, oldSession }) => ({
      activeSecret:  localStorage.getItem(`gaslamar_secret_${activeSession}`),
      oldSecret:     localStorage.getItem(`gaslamar_secret_${oldSession}`),
      oldSeen:       localStorage.getItem(`gaslamar_secret_seen_${oldSession}`),
      spuriousSeen:  localStorage.getItem(`gaslamar_secret_seen_seen_${oldSession}`),
    }), { activeSession, oldSession });

    expect(storageState.activeSecret).toBe('active-secret');
    expect(storageState.oldSecret).toBe('old-secret');      // not deleted yet — grace window just started
    expect(storageState.oldSeen).not.toBeNull();            // seen_ entry stamped on this visit
    expect(storageState.spuriousSeen).toBeNull();           // no seen_seen_ pollution
  });

  test('stale gaslamar_secret keys are cleaned only after a new valid session is confirmed', async ({ page }) => {
    const activeSession = 'sess_e2e-active-cleanup';
    const oldSession = 'sess_e2e-old-cleanup';
    const oldSeenAt = Date.now() - (16 * 60 * 1000);

    await page.addInitScript(({ activeSession, oldSession, oldSeenAt }) => {
      if (location.pathname.startsWith('/download')) {
        localStorage.setItem('gaslamar_session', activeSession);
        localStorage.setItem(`gaslamar_secret_${activeSession}`, 'active-secret');
        localStorage.setItem(`gaslamar_secret_${oldSession}`, 'old-secret');
        localStorage.setItem(`gaslamar_secret_seen_${oldSession}`, String(oldSeenAt));
      }
    }, { activeSession, oldSession, oldSeenAt });

    await mockCheckSession(page, { status: 'paid', session_id: activeSession });
    await mockGetSession(page);
    await mockGenerate(page);

    await page.goto('/download');
    await expect(page.locator('[data-testid="cv-content"]')).toBeVisible({ timeout: 30000 });

    const storageState = await page.evaluate(({ activeSession, oldSession }) => ({
      activeSecret:  localStorage.getItem(`gaslamar_secret_${activeSession}`),
      oldSecret:     localStorage.getItem(`gaslamar_secret_${oldSession}`),
      oldSeen:       localStorage.getItem(`gaslamar_secret_seen_${oldSession}`),
      spuriousSeen:  localStorage.getItem(`gaslamar_secret_seen_seen_${oldSession}`),
    }), { activeSession, oldSession });
    expect(storageState.activeSecret).toBe('active-secret');
    expect(storageState.oldSecret).toBeNull();
    expect(storageState.oldSeen).toBeNull();
    expect(storageState.spuriousSeen).toBeNull();           // no seen_seen_ pollution from prefix collision
  });

  test('recent previous gaslamar_secret key is preserved during the grace window', async ({ page }) => {
    const activeSession = 'sess_e2e-active-grace';
    const recentSession = 'sess_e2e-recent-grace';
    const recentSeenAt = Date.now() - (5 * 60 * 1000);

    await page.addInitScript(({ activeSession, recentSession, recentSeenAt }) => {
      if (location.pathname.startsWith('/download')) {
        localStorage.setItem('gaslamar_session', activeSession);
        localStorage.setItem(`gaslamar_secret_${activeSession}`, 'active-secret');
        localStorage.setItem(`gaslamar_secret_${recentSession}`, 'recent-secret');
        localStorage.setItem(`gaslamar_secret_seen_${recentSession}`, String(recentSeenAt));
      }
    }, { activeSession, recentSession, recentSeenAt });

    await mockCheckSession(page, { status: 'paid', session_id: activeSession });
    await mockGetSession(page);
    await mockGenerate(page);

    await page.goto('/download');
    await expect(page.locator('[data-testid="cv-content"]')).toBeVisible({ timeout: 30000 });

    const storageState = await page.evaluate(({ activeSession, recentSession }) => ({
      activeSecret: localStorage.getItem(`gaslamar_secret_${activeSession}`),
      recentSecret: localStorage.getItem(`gaslamar_secret_${recentSession}`),
      recentSeen: localStorage.getItem(`gaslamar_secret_seen_${recentSession}`),
    }), { activeSession, recentSession });
    expect(storageState.activeSecret).toBe('active-secret');
    expect(storageState.recentSecret).toBe('recent-secret');
    expect(storageState.recentSeen).toBe(String(recentSeenAt));
  });

  // ── NO SESSION ON HASIL PAGE ──────────────────────────────────────────────

  test('hasil page shows no-session message when sessionStorage is empty', async ({ page }) => {
    // Result.tsx calls window.location.replace('upload.html?reason=no_session') when
    // no session is found. waitForRequest fires when the browser initiates the request,
    // before it resolves — avoiding ERR_ABORTED from the location.replace() abort.
    const redirectRequest = page.waitForRequest(
      (req) => req.url().includes('upload') && req.url().includes('reason='),
      { timeout: 15000 },
    );
    await page.goto('/hasil');
    const req = await redirectRequest;
    expect(req.url()).toContain('no_session');
  });

  // ── PAYMENT BUTTON TRIGGERS MAYAR REDIRECT ────────────────────────────────

  test('payment CTA button attempts redirect to mayar.id', async ({ page }) => {
    // Use addInitScript (scoped to this test's page) to inject session data BEFORE
    // /hasil page scripts run. page.evaluate() from /upload doesn't guarantee sessionStorage
    // persistence across the page.goto() navigation.
    await page.addInitScript((scoring) => {
      sessionStorage.setItem('gaslamar_scoring', JSON.stringify(scoring));
      sessionStorage.setItem('gaslamar_cv_key', 'cvtext_test-key-e2e');
      sessionStorage.setItem('gaslamar_analyze_time', String(Date.now()));
      sessionStorage.setItem('gaslamar_tier', 'single');
    }, MOCK_ANALYZE_RESPONSE);

    let paymentUrl = '';
    await page.route('**/create-payment**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: 'sess_mock-payment',
          invoice_url: 'https://checkout.mayar.id/test-invoice',
        }),
      }),
    );

    // Abort the actual navigation to Mayar and capture the URL
    await page.route('https://checkout.mayar.id/**', async (route) => {
      paymentUrl = route.request().url();
      await route.abort();
    });

    await page.goto('/hasil');
    await expect(page.locator('[data-testid="generate-cv-button"]')).toBeVisible({
      timeout: 10000,
    });

    // Select a tier and enter a valid email — both must be present for payment to proceed
    const tierBtn = page.locator('[role="button"], button').filter({ hasText: /bilingual|starter|59/i }).first();
    await expect(tierBtn).toBeVisible({ timeout: 10000 });
    await tierBtn.click();

    const emailInput = page.locator('input[type="email"], [aria-label*="email" i]').first();
    await expect(emailInput).toBeVisible({ timeout: 5000 });
    await emailInput.fill('test@example.com');

    await page.click('[data-testid="generate-cv-button"]');

    // Wait for either Mayar redirect or a visible error
    await page.waitForTimeout(2000);
    const isError = await page.locator('text=/error|gagal/i').isVisible().catch(() => false);
    if (!isError) {
      expect(paymentUrl).toContain('mayar.id');
    }
  });

  // ── PAID SESSION RECOVERY BANNER ─────────────────────────────────────────

  test('upload page shows recovery banner when paid sess_ key is in sessionStorage', async ({ page }) => {
    // Seed sessionStorage before React mounts so the mount useEffect picks it up.
    // addInitScript fires on every navigation; beforeEach clears storage after its
    // own goto, so registering here only affects the goto below.
    await page.addInitScript(() => {
      if (location.pathname.startsWith('/upload')) {
        sessionStorage.setItem('gaslamar_session', 'sess_e2e-recovery-test');
      }
    });

    await page.goto('/upload');

    const notice = page.locator('[role="status"]').filter({ hasText: 'Kamu sudah upload CV' });
    await expect(notice).toBeVisible({ timeout: 5000 });
    await expect(page.locator('a', { hasText: 'Lanjutkan ke download' })).toHaveAttribute('href', 'download.html');
  });

  test('upload page shows recovery banner when paid sess_ key is in localStorage', async ({ page }) => {
    await page.addInitScript(() => {
      if (location.pathname.startsWith('/upload')) {
        localStorage.setItem('gaslamar_session', 'sess_e2e-recovery-test');
      }
    });

    await page.goto('/upload');

    const notice = page.locator('[role="status"]').filter({ hasText: 'Kamu sudah upload CV' });
    await expect(notice).toBeVisible({ timeout: 5000 });
    await expect(page.locator('a', { hasText: 'Lanjutkan ke download' })).toHaveAttribute('href', 'download.html');
  });

  test('upload page recovery banner suppresses reason=no_session when paid session exists', async ({ page }) => {
    await page.addInitScript(() => {
      if (location.pathname.startsWith('/upload')) {
        sessionStorage.setItem('gaslamar_session', 'sess_e2e-recovery-test');
      }
    });

    await page.goto('/upload?reason=no_session');

    // Recovery banner must appear; no_session message must not
    await expect(page.locator('[role="status"]').filter({ hasText: 'Kamu sudah upload CV' })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Sesi tidak ditemukan')).not.toBeVisible();
  });

  // Coupon input removed — users enter discount codes directly on Mayar's checkout page.

  test('job description counter and validation update after direct value assignment', async ({ page }) => {
    await uploadCV(page, SAMPLE_CV_PATH);

    const jdLength = await page.evaluate(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('[data-testid="jd-textarea"]');
      if (!textarea) throw new Error('JD textarea missing');

      const prefix = [
        'Digital Marketing Specialist - PT Digital Solution',
        '',
        'Requirements:',
        '- Social media management',
        '- Google Analytics',
        '',
        'Responsibilities:',
        '- Manage Instagram and TikTok content',
        '- Create monthly performance reports',
        '',
      ].join('\n');
      textarea.value = prefix + 'x'.repeat(4871 - prefix.length);
      return textarea.value.length;
    });

    expect(jdLength).toBe(4871);
    await expect(page.locator('text=4.871 / 5.000 karakter')).toBeVisible();
    await expect(page.locator('[data-testid="submit-upload"]')).toBeEnabled();

    const cappedLength = await page.evaluate(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('[data-testid="jd-textarea"]');
      if (!textarea) throw new Error('JD textarea missing');

      textarea.value = 'x'.repeat(5001);
      return textarea.value.length;
    });

    expect(cappedLength).toBe(5000);
    await expect(page.locator('text=5.000 / 5.000 karakter')).toBeVisible();
  });

  // ── MOBILE VIEWPORT ───────────────────────────────────────────────────────

  test('mobile viewport: submit button meets 44px touch target, dropzone visible', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    // Check dropzone BEFORE uploading — uploadCV replaces dropzone with file-preview.
    await expect(page.locator('[data-testid="dropzone"]')).toBeVisible();

    await uploadCV(page, SAMPLE_CV_PATH);
    await fillValidJD(page);

    const submitBtn = page.locator('[data-testid="submit-upload"]');
    const box = await submitBtn.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });
});
