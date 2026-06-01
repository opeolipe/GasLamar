/**
 * Accessibility regression test for the upload page submit button.
 *
 * QA finding MEDIUM #1 (2026-06-01): button was reported with aria-disabled="true"
 * while native disabled was false. Root cause: stale staging deployment.
 *
 * Also covers the programmatic-input validation bug: submit button must re-enable
 * immediately after programmatic text insertion (paste CV, URL fetch, example JD)
 * without requiring an extra user interaction to trigger re-evaluation.
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

// ── Programmatic-input validation audit ───────────────────────────────────────

test.describe('Submit button — programmatic text input re-evaluation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/upload.html');
    await expect(page.getByTestId('submit-upload')).toBeVisible();
  });

  /**
   * Audit item 1: Paste CV text ≥1500 chars via the "Paste CV" tab.
   * Button must enable immediately — no extra click required.
   */
  test('paste CV text ≥1500 chars enables button without extra click', async ({ page }) => {
    // Pre-fill a valid JD so the only remaining blocker is the missing CV.
    await page.fill('[data-testid="jd-textarea"]', VALID_JD);
    await expect(page.getByTestId('submit-upload')).toBeDisabled();

    // Switch to the "Paste CV" tab.
    await page.getByRole('tab', { name: 'Paste CV' }).click();

    // Type a CV that meets the 1500-char minimum.
    const longCv = 'John Doe — Software Engineer\n\n'.repeat(60); // ~1800 chars
    await page.fill('#cv-paste', longCv);

    // Button must enable immediately — no additional interaction needed.
    await expect(page.getByTestId('submit-upload')).toBeEnabled();
    expect(await getAriaDisabled(page)).toBeNull();
  });

  /**
   * Audit item 1b: Clearing the paste textarea must disable the button immediately.
   */
  test('clearing paste textarea disables button immediately', async ({ page }) => {
    await page.fill('[data-testid="jd-textarea"]', VALID_JD);
    await page.getByRole('tab', { name: 'Paste CV' }).click();

    const longCv = 'Jane Doe — Product Manager\n\n'.repeat(60);
    await page.fill('#cv-paste', longCv);
    await expect(page.getByTestId('submit-upload')).toBeEnabled();

    // Clear the textarea — button must disable without any other interaction.
    await page.fill('#cv-paste', '');
    await expect(page.getByTestId('submit-upload')).toBeDisabled();
  });

  /**
   * Audit item 2: Fetch JD from URL — button re-evaluates immediately after fetch.
   * The worker endpoint is mocked to return a valid long JD without a real network call.
   */
  test('fetch JD from URL enables button immediately after successful fetch', async ({ page }) => {
    // Upload a CV file first so CV is ready.
    await page.setInputFiles('[data-testid="file-input"]', SAMPLE_CV);
    await expect(page.locator('[data-testid="file-preview"]')).toBeVisible();

    // Mock the worker /fetch-job-url endpoint.
    const mockedJd =
      'Software Engineer – PT Example\n\n' +
      'Requirements:\n- 3+ years experience with TypeScript\n' +
      '- Strong problem-solving skills\n- Experience with cloud platforms\n' +
      'Responsibilities:\n- Build scalable backend services\n' +
      '- Collaborate with cross-functional teams\n- Code reviews and mentoring';

    await page.route('**/fetch-job-url', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job_desc: mockedJd }) }),
    );

    // Open URL fetcher and submit.
    await page.getByRole('button', { name: /Ambil via link/i }).click();
    await page.locator('input[type="url"]').fill('https://glints.com/id/opportunities/jobs/fake');
    await page.getByRole('button', { name: /^Ambil$/i }).click();

    // Button must enable immediately without any extra user interaction.
    await expect(page.getByTestId('submit-upload')).toBeEnabled();
    expect(await getAriaDisabled(page)).toBeNull();
  });

  /**
   * Audit item 3: Manual typing updates button state on each keystroke.
   */
  test('manual JD typing gates button correctly on each keystroke', async ({ page }) => {
    await page.setInputFiles('[data-testid="file-input"]', SAMPLE_CV);
    await expect(page.locator('[data-testid="file-preview"]')).toBeVisible();
    await expect(page.getByTestId('submit-upload')).toBeDisabled();

    // Type exactly 99 chars — button stays disabled.
    const shortJd = 'A'.repeat(99);
    await page.fill('[data-testid="jd-textarea"]', shortJd);
    await expect(page.getByTestId('submit-upload')).toBeDisabled();

    // Type one more char to cross the 100-char threshold — button enables.
    await page.locator('[data-testid="jd-textarea"]').pressSequentially('B');
    await expect(page.getByTestId('submit-upload')).toBeEnabled();

    // Erase that char — button disables again.
    await page.locator('[data-testid="jd-textarea"]').press('Backspace');
    await expect(page.getByTestId('submit-upload')).toBeDisabled();
  });

  /**
   * Audit item 4 (regression): File upload path continues to work.
   */
  test('file upload path still enables button correctly', async ({ page }) => {
    await page.fill('[data-testid="jd-textarea"]', VALID_JD);
    await expect(page.getByTestId('submit-upload')).toBeDisabled();

    await page.setInputFiles('[data-testid="file-input"]', SAMPLE_CV);
    await expect(page.locator('[data-testid="file-preview"]')).toBeVisible();

    await expect(page.getByTestId('submit-upload')).toBeEnabled();
  });
});
