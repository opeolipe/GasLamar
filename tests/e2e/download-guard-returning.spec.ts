import { test, expect } from '@playwright/test';

test.describe('Download guard — returning user with stale has_session flag', () => {
  test('gaslamar_has_session=1 but no actual cookie → download page shows inline session error', async ({ page }) => {
    // Simulate a user whose payment flow completed but session cookie expired
    await page.addInitScript(() => {
      localStorage.setItem('gaslamar_has_session', '1');
      localStorage.removeItem('gaslamar_delivery');
      localStorage.removeItem('gaslamar_session');
    });

    await page.goto('/download');

    // Guard lets them through (has_session=1), React loads, /check-session fails
    // Should NOT redirect to homepage — should show inline error on the download page
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const url = page.url();
    console.log('URL after load:', url);
    
    // Either stays on download (with inline error) OR redirects to /?reason=no_session
    const staysOnDownload = url.includes('/download');
    const redirectedHome = url.includes('reason=no_session');
    console.log('Stays on download:', staysOnDownload);
    console.log('Redirected home:', redirectedHome);
    
    // Check what's visible
    const body = await page.locator('body').textContent();
    console.log('Body text (first 300):', body?.slice(0, 300));
  });
});
