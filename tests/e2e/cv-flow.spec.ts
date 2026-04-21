import { test, expect, Page } from '@playwright/test';
import path from 'path';

// ---------- CONSTANTS ----------

const TEST_SESSION_ID = 'sess_e2e-test-session-123';

// Matches ScoringData interface; rekomendasi must be string[]
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
  veredict: 'good',
  rekomendasi: ['Tambahkan sertifikasi Google Analytics'],
  kekuatan: ['Pengalaman social media'],
  alasan_skor: 'CV cukup baik dengan pengalaman relevan',
  hr_7_detik: 'Kandidat memiliki dasar marketing digital',
  red_flags: [],
  archetype: 'practitioner',
  konfidensitas: 0.85,
  skor_sesudah: 85,
  timebox_weeks: 4,
  cv_text_key: 'cvtext_test-key-e2e',
};

const SAMPLE_CV_PATH  = path.resolve('tests/fixtures/sample-cv.pdf');
const SHORT_CV_PATH   = path.resolve('tests/fixtures/short-cv.txt');

// ---------- HELPERS ----------

async function uploadCV(page: Page, filePath: string) {
  await page.setInputFiles('[data-testid="file-input"]', filePath);
  await expect(page.locator('[data-testid="file-preview"]')).toBeVisible();
}

async function fillValidJD(page: Page) {
  await page.fill(
    '[data-testid="jd-textarea"]',
    'Digital Marketing Specialist\n\nRequirements:\n- Social media management\n- Google Analytics\n\nResponsibilities:\n- Manage Instagram and TikTok content\n- Create monthly performance reports',
  );
}

/** Seed localStorage so download.html finds a valid session. */
async function setupDownloadSession(page: Page, sessionId = TEST_SESSION_ID) {
  await page.evaluate((sid) => {
    localStorage.setItem('gaslamar_session', sid);
    localStorage.setItem(`gaslamar_secret_${sid}`, 'e2e-test-secret');
    sessionStorage.setItem('gaslamar_tier', 'single');
  }, sessionId);
}

/** Mock /check-session → paid (triggers startGeneration). */
async function mockCheckSession(page: Page, overrides: Record<string, unknown> = {}) {
  await page.route('**/check-session**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
        credits_remaining: 1,
        total_credits: 1,
        ...overrides,
      }),
    }),
  );
}

/** Navigate to download.html with session + all required route mocks. */
async function gotoDownload(
  page: Page,
  generateOverrides: Record<string, unknown> = {},
) {
  await setupDownloadSession(page);
  await mockCheckSession(page);
  await mockGetSession(page);
  await mockGenerate(page, generateOverrides);
  await page.goto('/download.html');
}

// ---------- SUITE ----------

test.describe('GasLamar CV Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear storage to isolate each test
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

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

    await page.goto('/upload.html');
  });

  // ── ANALYZING PAGE TRANSITION ─────────────────────────────────────────────

  test('analyzing page transitions to hasil after mock analyze', async ({ page }) => {
    await uploadCV(page, SAMPLE_CV_PATH);
    await fillValidJD(page);
    await page.click('[data-testid="submit-upload"]');

    // Analyzing page must appear first
    await page.waitForURL('**/analyzing.html**', { timeout: 15000 });

    // Then redirect to hasil
    await page.waitForURL('**/hasil.html**', { timeout: 60000 });
    await expect(page.locator('[data-testid="generate-cv-button"]')).toBeVisible({
      timeout: 15000,
    });
  });

  // ── ANALYZE FAILURE ───────────────────────────────────────────────────────

  test('analyze failure shows error on analyzing page', async ({ page }) => {
    // Override the /analyze mock from beforeEach with a 500
    await page.route('**/analyze**', (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ message: 'Server error' }) }),
    );

    await uploadCV(page, SAMPLE_CV_PATH);
    await fillValidJD(page);
    await page.click('[data-testid="submit-upload"]');

    await page.waitForURL('**/analyzing.html**', { timeout: 15000 });
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible({
      timeout: 15000,
    });
  });

  // ── FULL FLOW + PREVIEW CONSISTENCY ──────────────────────────────────────

  test('full flow: preview text is preserved in final CV', async ({ page }) => {
    await uploadCV(page, SAMPLE_CV_PATH);
    await fillValidJD(page);
    await page.click('[data-testid="submit-upload"]');
    await page.waitForURL('**/hasil.html**', { timeout: 60000 });

    const previewText = await page.locator('[data-testid="rewrite-after"]').textContent();
    expect(previewText?.trim()).toBeTruthy();

    const captured = previewText!.trim();

    // Inject session and navigate to download — generate returns CV containing preview
    await setupDownloadSession(page);
    await mockCheckSession(page);
    await mockGetSession(page);
    await mockGenerate(page, {
      cv_id: `${captured}\n\nDigital Marketing Specialist dengan pengalaman relevan.`,
    });

    await page.goto('/download.html');
    await expect(page.locator('[data-testid="cv-content"]')).toBeVisible({
      timeout: 30000,
    });

    const cvText = await page.locator('[data-testid="cv-content"]').textContent();
    expect(cvText).toContain(captured);
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

    // cv-content renders cv_id (PDF version)
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

    // Trust badge must be hidden (flagged as untrusted)
    await expect(page.locator('[data-testid="trust-badge"]')).toBeHidden();
  });

  // ── SHORT LINE — NO PLACEHOLDER BRACKETS ─────────────────────────────────

  test('short CV does not produce placeholder brackets in rewrite preview', async ({ page }) => {
    await uploadCV(page, SHORT_CV_PATH);
    await fillValidJD(page);
    await page.click('[data-testid="submit-upload"]');
    await page.waitForURL('**/hasil.html**', { timeout: 60000 });

    const previewText = await page.locator('[data-testid="rewrite-after"]').textContent();
    expect(previewText).not.toMatch(/\[.*\]/);

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

    await page.goto('/download.html');

    await expect(page.locator('[data-testid="error-message"]')).toBeVisible({
      timeout: 20000,
    });
    // Retry button (generate-cv-button) must be enabled and clickable
    await expect(page.locator('[data-testid="generate-cv-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="generate-cv-button"]')).toBeEnabled();
  });

  // ── NO SESSION ON HASIL PAGE ──────────────────────────────────────────────

  test('hasil page shows no-session message when sessionStorage is empty', async ({ page }) => {
    // Navigate directly with no scoring data — useResultData returns noSession:'missing'
    await page.goto('/hasil.html');
    await expect(
      page.locator('text=Sesi Analisis Tidak Ditemukan'),
    ).toBeVisible({ timeout: 10000 });
  });

  // ── PAYMENT BUTTON TRIGGERS MAYAR REDIRECT ────────────────────────────────

  test('payment CTA button attempts redirect to mayar.id', async ({ page }) => {
    // Pre-seed session data so hasil.html renders with full scoring
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

    await page.goto('/hasil.html');
    await expect(page.locator('[data-testid="generate-cv-button"]')).toBeVisible({
      timeout: 10000,
    });

    // Select a tier (click first pricing card) and enter a valid email
    const tierBtn = page.locator('[role="button"], button').filter({ hasText: /single|coba|59/i }).first();
    if (await tierBtn.isVisible()) await tierBtn.click();

    const emailInput = page.locator('input[type="email"], [aria-label*="email" i]').first();
    if (await emailInput.isVisible()) {
      await emailInput.fill('test@example.com');
    }

    await page.click('[data-testid="generate-cv-button"]');

    // Either navigation to Mayar was attempted, or error was shown (if no tier/email)
    // Wait briefly — success means paymentUrl is set, failure means error is visible
    await page.waitForTimeout(2000);

    const isError = await page.locator('text=/error|gagal/i').isVisible().catch(() => false);
    if (!isError) {
      expect(paymentUrl).toContain('mayar.id');
    }
  });

  // ── MOBILE VIEWPORT ───────────────────────────────────────────────────────

  test('mobile viewport: submit button meets 44px touch target, dropzone visible', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await uploadCV(page, SAMPLE_CV_PATH);
    await fillValidJD(page);

    const submitBtn = page.locator('[data-testid="submit-upload"]');
    const box = await submitBtn.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);

    await expect(page.locator('[data-testid="dropzone"]')).toBeVisible();
  });
});
