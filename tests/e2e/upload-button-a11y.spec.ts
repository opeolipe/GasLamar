/**
 * Accessibility regression test for the upload page submit button.
 *
 * QA finding MEDIUM #1 (2026-06-01): button was reported with aria-disabled="true"
 * while native disabled was false. Root cause: stale staging deployment.
 * This test guards against both the stale-deploy scenario and future regressions.
 */
import { test, expect } from '@playwright/test';
import path from 'path';

const SAMPLE_CV = path.resolve('tests/fixtures/sample-cv.pdf');

const VALID_JD =
  'Product Manager – PT Teknologi Maju\n\n' +
  'Requirements:\n- 3+ years product experience\n- Stakeholder management\n' +
  'Responsibilities:\n- Define roadmap\n- Work with engineering and design teams';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the current value of aria-disabled on the submit button (null = absent). */
async function getAriaDisabled(page: import('@playwright/test').Page) {
  return page.getByTestId('submit-upload').getAttribute('aria-disabled');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Upload submit button — accessibility invariants', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/upload.html');
    // Wait for the React tree to mount.
    await expect(page.getByTestId('submit-upload')).toBeVisible();
  });

  test('button is natively disabled on page load and carries no aria-disabled', async ({ page }) => {
    const btn = page.getByTestId('submit-upload');

    // Native disabled — screen readers announce "dimmed/unavailable" automatically.
    await expect(btn).toBeDisabled();

    // aria-disabled must never be present (redundant with native disabled and
    // caused screen reader double-announcement on older AT versions).
    expect(await getAriaDisabled(page)).toBeNull();
  });

  test('button becomes enabled after valid CV + JD and still carries no aria-disabled', async ({ page }) => {
    const btn = page.getByTestId('submit-upload');

    // Upload a CV file.
    await page.setInputFiles('[data-testid="file-input"]', SAMPLE_CV);
    await expect(page.locator('[data-testid="file-preview"]')).toBeVisible();

    // Fill a job description that meets the 100-char minimum.
    await page.fill('[data-testid="jd-textarea"]', VALID_JD);

    // Button must become enabled.
    await expect(btn).toBeEnabled();

    // aria-disabled must remain absent even when the button is enabled.
    expect(await getAriaDisabled(page)).toBeNull();
  });

  test('button returns to disabled when CV is removed and still carries no aria-disabled', async ({ page }) => {
    // Upload then remove.
    await page.setInputFiles('[data-testid="file-input"]', SAMPLE_CV);
    await expect(page.locator('[data-testid="file-preview"]')).toBeVisible();
    await page.fill('[data-testid="jd-textarea"]', VALID_JD);
    await expect(page.getByTestId('submit-upload')).toBeEnabled();

    // Remove file — click the remove/clear button if present.
    const removeBtn = page.locator('[data-testid="file-preview"]').locator('button').first();
    if (await removeBtn.isVisible()) {
      await removeBtn.click();
    }

    // Button must be disabled again.
    await expect(page.getByTestId('submit-upload')).toBeDisabled();
    expect(await getAriaDisabled(page)).toBeNull();
  });
});
