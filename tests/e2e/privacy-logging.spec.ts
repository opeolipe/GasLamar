import { test, expect } from '@playwright/test';

test.describe('Logging and analytics minimization', () => {
  test('PostHog config strips tokenized URLs and disables autocapture/session replay', async ({ page }) => {
    await page.route('https://eu-assets.i.posthog.com/static/array.js', route => route.abort());
    await page.goto('/upload?session=sess_test&token=abc123');

    const result = await page.evaluate(() => {
      const init = (window as any).posthog?._i?.[0];
      const config = init?.[1] || {};
      const props = config.sanitize_properties?.({
        $current_url: 'https://gaslamar.com/download?session=sess_test&token=abc123&sessionId=sess_test&utm_source=test',
        $referrer: 'https://gaslamar.com/access?token=abc123&sessionId=sess_test',
        $initial_current_url: 'https://gaslamar.com/upload?session=sess_test',
      });
      return {
        autocapture: config.autocapture,
        disableSessionRecording: config.disable_session_recording,
        currentUrl: props?.$current_url,
        referrer: props?.$referrer,
        initialUrl: props?.$initial_current_url,
      };
    });

    expect(result.autocapture).toBe(false);
    expect(result.disableSessionRecording).toBe(true);
    expect(result.currentUrl).toContain('utm_source=test');
    expect(result.currentUrl).not.toContain('session=');
    expect(result.currentUrl).not.toContain('token=');
    expect(result.currentUrl).not.toContain('sessionId=');
    expect(result.referrer).not.toContain('token=');
    expect(result.referrer).not.toContain('sessionId=');
    expect(result.initialUrl).not.toContain('session=');
  });
});
