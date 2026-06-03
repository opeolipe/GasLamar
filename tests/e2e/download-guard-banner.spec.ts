import { test, expect } from '@playwright/test';

test.describe('Download guard → homepage banner', () => {
  test('fresh browser navigating to /download redirects to /?reason=no_session and shows banner', async ({ page }) => {
    // Remove all session markers
    await page.addInitScript(() => {
      localStorage.removeItem('gaslamar_delivery');
      localStorage.removeItem('gaslamar_session');
      localStorage.removeItem('gaslamar_has_session');
    });

    await page.goto('/download');

    // Wait for redirect
    await page.waitForURL(/\?reason=no_session/, { timeout: 8_000 });

    // URL must include reason=no_session
    expect(page.url()).toContain('reason=no_session');

    // Banner must be visible
    const banner = page.locator('[role="alert"]');
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // Banner must have the correct message
    await expect(banner).toContainText('Sesi analisis kamu tidak ditemukan');

    // Must have an Upload CV link
    const uploadBtn = banner.locator('a', { hasText: 'Upload CV' });
    await expect(uploadBtn).toBeVisible();
    await expect(uploadBtn).toHaveAttribute('href', /upload/);
  });
});
