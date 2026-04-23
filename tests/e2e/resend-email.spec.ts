import { test, expect } from '@playwright/test';

async function mockSession(page) {
  await page.addInitScript(() => {
    localStorage.setItem('gaslamar_delivery', JSON.stringify({
      sessionId: 'test-session',
      email: 'user@gmail.com',
      sentAt: Date.now()
    }));
  });
}

test.describe('Resend Email System', () => {
  test.beforeEach(async ({ page }) => {
    await mockSession(page);
    await page.goto('/download.html');
    await expect(page.locator('text=CV kamu sudah siap digunakan')).toBeVisible();
  });

  test('resend to same email works', async ({ page }) => {
    await page.route('**/resend-email', route =>
      route.fulfill({ status: 200, body: JSON.stringify({ success: true }) })
    );
    await page.click('text=Resend ke user@gmail.com');
    await expect(page.locator('text=CV berhasil dikirim ulang')).toBeVisible();
  });

  test('resend button disabled after click', async ({ page }) => {
    await page.route('**/resend-email', route =>
      route.fulfill({ status: 200, body: JSON.stringify({ success: true }) })
    );
    const button = page.locator('text=Resend ke user@gmail.com');
    await button.click();
    await expect(button).toBeDisabled();
  });

  test('change email and resend works', async ({ page }) => {
    await page.route('**/resend-email', route =>
      route.fulfill({ status: 200, body: JSON.stringify({ success: true }) })
    );
    await page.click('text=Ganti email');
    await page.fill('input[type="email"]', 'newuser@gmail.com');
    await page.click('text=Kirim ulang');
    await expect(page.locator('text=CV berhasil dikirim ulang ke newuser@gmail.com')).toBeVisible();
  });

  test('blocks typo email during resend', async ({ page }) => {
    await page.click('text=Ganti email');
    await page.fill('input[type="email"]', 'user@gmal.com');
    await page.locator('input[type="email"]').blur();
    await expect(page.locator('text=Maksud kamu')).toBeVisible();
    await expect(page.locator('text=Kirim ulang')).toBeDisabled();
  });

  test('blocks invalid email', async ({ page }) => {
    await page.click('text=Ganti email');
    await page.fill('input[type="email"]', 'notanemail');
    await page.click('text=Kirim ulang');
    await expect(page.locator('text=Email tidak valid')).toBeVisible();
  });

  test('handles resend failure', async ({ page }) => {
    await page.route('**/resend-email', route => route.fulfill({ status: 500 }));
    await page.click('text=Resend ke user@gmail.com');
    await expect(page.locator('text=Gagal mengirim ulang')).toBeVisible();
  });

  test('redirect if session missing', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('gaslamar_delivery'));
    await page.goto('/download.html');
    await expect(page).toHaveURL('/');
  });

  test('prevents multiple rapid resend clicks', async ({ page }) => {
    await page.route('**/resend-email', async route => {
      await new Promise(r => setTimeout(r, 300));
      route.fulfill({ status: 200, body: JSON.stringify({ success: true }) });
    });
    const btn = page.locator('text=Resend ke user@gmail.com');
    await btn.click();
    await btn.click();
    await expect(btn).toBeDisabled();
  });

  test('handles slow resend response gracefully', async ({ page }) => {
    await page.route('**/resend-email', async route => {
      await new Promise(r => setTimeout(r, 2000));
      route.fulfill({ status: 200, body: JSON.stringify({ success: true }) });
    });
    await page.click('text=Resend ke user@gmail.com');
    await expect(page.locator('text=Mengirim ulang...')).toBeVisible();
  });

  test('handles network failure', async ({ page }) => {
    await page.route('**/resend-email', route => route.abort());
    await page.click('text=Resend ke user@gmail.com');
    await expect(page.locator('text=Gagal mengirim ulang')).toBeVisible();
  });

  test('handles rate limit', async ({ page }) => {
    await page.route('**/resend-email', route => route.fulfill({ status: 429 }));
    await page.click('text=Resend ke user@gmail.com');
    await expect(page.locator('text=Coba lagi dalam beberapa saat')).toBeVisible();
  });

  test('handles expired session during resend', async ({ page }) => {
    await page.route('**/resend-email', route => route.fulfill({ status: 401 }));
    await page.click('text=Resend ke user@gmail.com');
    await expect(page).toHaveURL('/');
  });

  test('normalizes email before resend', async ({ page }) => {
    await page.click('text=Ganti email');
    await page.fill('input[type="email"]', ' USER@GMAIL.COM ');
    await page.locator('input[type="email"]').blur();
    await expect(page.locator('text=✓')).toBeVisible();
  });

  test('cannot resend while suggestion exists', async ({ page }) => {
    await page.click('text=Ganti email');
    await page.fill('input[type="email"]', 'user@gmal.com');
    await page.locator('input[type="email"]').blur();
    await expect(page.locator('text=Kirim ulang')).toBeDisabled();
  });

  test('allows disposable email but shows warning', async ({ page }) => {
    await page.click('text=Ganti email');
    await page.fill('input[type="email"]', 'user@mailinator.com');
    await page.locator('input[type="email"]').blur();
    await expect(page.locator('text=Gunakan email aktif')).toBeVisible();
  });

  test('cooldown resets after timeout', async ({ page }) => {
    await page.route('**/resend-email', route =>
      route.fulfill({ status: 200, body: JSON.stringify({ success: true }) })
    );
    const btn = page.locator('text=Resend ke user@gmail.com');
    await btn.click();
    await expect(btn).toBeDisabled();
    await page.waitForTimeout(31000);
    await expect(btn).toBeEnabled();
  });
});
