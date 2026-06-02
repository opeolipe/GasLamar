/**
 * Security invariant tests — guards against false-positive QA findings.
 *
 * QA finding (2026-06-01):
 *   "Session token IDOR" — tester looked for session_token / server_session_id in storage.
 *   Root cause: GasLamar does not store raw auth tokens client-side; auth is via
 *   an HttpOnly cv_key cookie (not accessible via JS). This suite asserts that
 *   invariant on every commit so future audits have an automated baseline.
 *
 * What is NOT a finding:
 *   - gaslamar_cv_key is absent from sessionStorage (it's an HttpOnly cookie)
 *   - document.cookie does not contain cv_key (HttpOnly = not visible to JS)
 *   - No keys named session_token / auth_token / jwt / bearer in client storage
 */
import { test, expect } from '@playwright/test';

// Keys that must never appear in client-visible storage on any page.
const FORBIDDEN_STORAGE_KEYS = [
  'session_token',
  'auth_token',
  'jwt',
  'bearer',
  'access_token',
  'refresh_token',
  'gaslamar_cv_key',        // stored as HttpOnly cookie, never in JS-accessible storage
  'server_session_id',
  'gaslamar_session',       // payment session token — HttpOnly cookie, never in JS storage
  'gaslamar_user_id',       // analytics ID — in-memory only, not persisted to storage
  'gaslamar_skor',          // score number — not stored client-side; fetched via /get-scoring
  'gaslamar_pending_invoice', // invoice URL — removed; server protects against double-creation
  'gaslamar_result_id',     // result ID — server-generated, not stored in JS storage
];

/** Returns all keys present in sessionStorage and localStorage. */
async function getAllStorageKeys(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    session: Object.keys(sessionStorage),
    local:   Object.keys(localStorage),
    cookie:  document.cookie,
  }));
}

test.describe('Client-storage security invariants', () => {
  test('upload page — no raw auth tokens in sessionStorage or localStorage', async ({ page }) => {
    await page.goto('/upload.html');
    await page.waitForLoadState('domcontentloaded');

    const storage = await getAllStorageKeys(page);

    for (const key of FORBIDDEN_STORAGE_KEYS) {
      expect(
        storage.session,
        `sessionStorage must not contain '${key}'`,
      ).not.toContain(key);
      expect(
        storage.local,
        `localStorage must not contain '${key}'`,
      ).not.toContain(key);
    }

    // HttpOnly cv_key cookie must not be visible via document.cookie.
    expect(storage.cookie).not.toContain('cv_key');
  });

  test('upload page — auth is via HttpOnly cookie, not JS-readable storage', async ({ page }) => {
    // Intercept a mock /analyze response that sets a cv_key cookie.
    await page.route('/analyze', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          // Simulate the HttpOnly cookie the real worker sets.
          // Playwright intercepts the response; the header alone exercises guard logic.
          'Set-Cookie': 'cv_key=cvtext_abc123; HttpOnly; Secure; SameSite=None; Path=/',
        },
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/upload.html');
    await page.waitForLoadState('domcontentloaded');

    // cv_key must not be readable via JS regardless.
    const cookieViaJS = await page.evaluate(() => document.cookie);
    expect(cookieViaJS).not.toContain('cv_key');

    // And it must not have leaked into sessionStorage.
    const sessionKeys = await page.evaluate(() => Object.keys(sessionStorage));
    expect(sessionKeys).not.toContain('cv_key');
    expect(sessionKeys).not.toContain('gaslamar_cv_key');
  });

  test('hasil page — no raw auth tokens after scoring data is loaded from sessionStorage', async ({ page }) => {
    // Seed the minimum sessionStorage state hasil-guard.js requires.
    await page.goto('/hasil.html');
    await page.evaluate(() => {
      sessionStorage.setItem('gaslamar_analyze_time', String(Date.now()));
      // Minimal scoring blob so the guard doesn't redirect.
      sessionStorage.setItem('gaslamar_scoring', JSON.stringify({
        skor: 72, verdict: 'DO', tier: 'single',
      }));
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const storage = await getAllStorageKeys(page);

    for (const key of FORBIDDEN_STORAGE_KEYS) {
      expect(storage.session, `sessionStorage must not contain '${key}'`).not.toContain(key);
      expect(storage.local,   `localStorage must not contain '${key}'`).not.toContain(key);
    }
    expect(storage.cookie).not.toContain('cv_key');
  });
});
