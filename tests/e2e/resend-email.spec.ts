import { test, expect, Page } from '@playwright/test';

// ── Constants ─────────────────────────────────────────────────────────────────

const MOCK_DELIVERY = {
  sessionId: 'sess_resend-e2e-123',
  email:     'user@example.com',
  sentAt:    Date.now() - 120_000, // 2 minutes ago
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seed gaslamar_delivery into localStorage BEFORE the page scripts run. */
function setupDelivery(page: Page, overrides: Partial<typeof MOCK_DELIVERY> = {}) {
  const delivery = { ...MOCK_DELIVERY, ...overrides };
  return page.addInitScript((d) => {
    localStorage.setItem('gaslamar_delivery', JSON.stringify(d));
  }, delivery);
}

/** Mock the /resend-email worker endpoint. */
function mockResend(
  page: Page,
  response: { status: number; body?: string; contentType?: string },
) {
  return page.route('**/resend-email**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body:        '{}',
      ...response,
    }),
  );
}

/** Mock check-session to return a stable error so it doesn't interfere. */
async function suppressCheckSession(page: Page) {
  await page.route('**/check-session**', (route) =>
    route.fulfill({
      status:      401,
      contentType: 'application/json',
      body:        JSON.stringify({ error: 'no session' }),
    }),
  );
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('ResendEmail — button label & loading state', () => {
  test('button label stays "Resend ke {email}" — not "Mengirim..." — while sending', async ({ page }) => {
    await setupDelivery(page);
    await suppressCheckSession(page);

    // Slow route: hold the request until we've made assertions
    let resolveResend!: () => void;
    await page.route('**/resend-email**', async (route) => {
      await new Promise<void>((r) => { resolveResend = r; });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/download');

    const btn = page.locator('button', { hasText: 'Resend ke user@example.com' });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();

    // Button must still show static label — NOT "Mengirim..."
    await expect(page.locator('button', { hasText: 'Resend ke user@example.com' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Mengirim...' })).not.toBeVisible();

    resolveResend();
  });

  test('shows "Mengirim ulang..." paragraph during send', async ({ page }) => {
    await setupDelivery(page);
    await suppressCheckSession(page);

    let resolveResend!: () => void;
    await page.route('**/resend-email**', async (route) => {
      await new Promise<void>((r) => { resolveResend = r; });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/download');

    const btn = page.locator('button', { hasText: 'Resend ke user@example.com' });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();

    // Separate <p> must appear
    await expect(page.locator('text=Mengirim ulang...')).toBeVisible();

    resolveResend();
  });

  test('cooldown countdown appears in a separate element — not inside the button', async ({ page }) => {
    await setupDelivery(page);
    await suppressCheckSession(page);
    await mockResend(page, { status: 200, body: '{}' });

    await page.goto('/download');

    const btn = page.locator('button', { hasText: 'Resend ke user@example.com' });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();

    // Wait for success, then cooldown kicks in
    await expect(page.locator('text=CV berhasil dikirim ulang ke user@example.com.')).toBeVisible({ timeout: 5_000 });

    // Button still shows static label
    await expect(page.locator('button', { hasText: 'Resend ke user@example.com' })).toBeVisible();
    // Countdown NOT inside a button
    await expect(page.locator('button', { hasText: /Kirim ulang dalam/ })).not.toBeVisible();
    // Countdown IS in some other element (p / span / div)
    await expect(page.locator('text=/Kirim ulang dalam \\d+s/')).toBeVisible();
  });
});

test.describe('ResendEmail — 60s guard removed', () => {
  test('resend works even when sentAt is only 5s ago (no RECENT_GUARD error)', async ({ page }) => {
    // sentAt 5s ago — the old 60s guard would have blocked this
    await setupDelivery(page, { sentAt: Date.now() - 5_000 });
    await suppressCheckSession(page);
    await mockResend(page, { status: 200, body: '{}' });

    await page.goto('/download');

    const btn = page.locator('button', { hasText: 'Resend ke user@example.com' });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();

    // Must NOT see old guard message
    await expect(page.locator('text=Email baru saja dikirim')).not.toBeVisible();
    // Must see success
    await expect(
      page.locator('text=CV berhasil dikirim ulang ke user@example.com.'),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('same-email success message exact format', async ({ page }) => {
    await setupDelivery(page);
    await suppressCheckSession(page);
    await mockResend(page, { status: 200, body: '{}' });

    await page.goto('/download');

    const btn = page.locator('button', { hasText: 'Resend ke user@example.com' });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();

    await expect(
      page.locator('text=CV berhasil dikirim ulang ke user@example.com.'),
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('ResendEmail — change email', () => {
  test('change-email success uses "CV berhasil dikirim ulang ke {new email}."', async ({ page }) => {
    await setupDelivery(page);
    await suppressCheckSession(page);
    await mockResend(page, { status: 200, body: '{}' });

    await page.goto('/download');

    const gantiBtn = page.locator('button', { hasText: 'Ganti email' });
    await expect(gantiBtn).toBeVisible({ timeout: 15_000 });
    await gantiBtn.click();

    await page.fill('input[type="email"]', 'new@example.com');
    // Trigger blur validation so the submit button is enabled
    await page.locator('input[type="email"]').blur();
    await page.waitForTimeout(300); // blur debounce

    await page.locator('button[type="submit"]').click();

    await expect(
      page.locator('text=CV berhasil dikirim ulang ke new@example.com.'),
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('ResendEmail — error handling', () => {
  test('429 with no JSON body shows static rate-limit message', async ({ page }) => {
    await setupDelivery(page);
    await suppressCheckSession(page);
    // Bare 429 — no JSON body
    await mockResend(page, { status: 429, body: '', contentType: 'text/plain' });

    await page.goto('/download');

    const btn = page.locator('button', { hasText: 'Resend ke user@example.com' });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();

    await expect(
      page.locator('text=Terlalu banyak permintaan. Coba lagi dalam beberapa saat.'),
    ).toBeVisible({ timeout: 5_000 });

    // Must NOT contain dynamic retry-after seconds
    await expect(page.locator('text=/dalam \\d+ detik/')).not.toBeVisible();
  });

  test('401 response redirects to root and clears gaslamar_delivery', async ({ page }) => {
    await setupDelivery(page);
    await suppressCheckSession(page);
    await mockResend(page, { status: 401, body: JSON.stringify({ error: 'unauthorized' }) });

    await page.goto('/download');

    const btn = page.locator('button', { hasText: 'Resend ke user@example.com' });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();

    await page.waitForURL('http://localhost:3000/', { timeout: 8_000 });

    // Delivery must be cleared from localStorage
    const deliveryAfter = await page.evaluate(() => localStorage.getItem('gaslamar_delivery'));
    expect(deliveryAfter).toBeNull();
  });

  test('404 response redirects to root', async ({ page }) => {
    await setupDelivery(page);
    await suppressCheckSession(page);
    await mockResend(page, { status: 404, body: JSON.stringify({ error: 'not found' }) });

    await page.goto('/download');

    const btn = page.locator('button', { hasText: 'Resend ke user@example.com' });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();

    await page.waitForURL('http://localhost:3000/', { timeout: 8_000 });
  });
});

test.describe('Download page — delivery guard', () => {
  test('delivery in localStorage renders heading and ResendEmail widget', async ({ page }) => {
    await setupDelivery(page);
    await suppressCheckSession(page);

    await page.goto('/download');

    await expect(
      page.locator('text=CV kamu sudah siap digunakan'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Belum menerima email?')).toBeVisible({ timeout: 5_000 });
  });

  test('no delivery and no session redirects to root', async ({ page }) => {
    // Ensure both keys are absent before page load
    await page.addInitScript(() => {
      localStorage.removeItem('gaslamar_delivery');
      localStorage.removeItem('gaslamar_session');
    });

    await page.goto('/download');

    await page.waitForURL('http://localhost:3000/', { timeout: 8_000 });
  });

  test('delivery present suppresses SessionError even when view is error', async ({ page }) => {
    await setupDelivery(page);
    // check-session returning 401 drives the session into error state
    await suppressCheckSession(page);

    await page.goto('/download');

    // Delivery section must appear
    await expect(
      page.locator('text=CV kamu sudah siap digunakan'),
    ).toBeVisible({ timeout: 10_000 });

    // SessionError must NOT appear
    await expect(page.locator('[data-testid="error-message"]')).not.toBeVisible();
  });
});
