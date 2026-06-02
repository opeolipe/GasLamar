/**
 * Static-analysis unit test: verifies that no upload UI component ever emits
 * an aria-disabled attribute on the submit button.
 *
 * Why static analysis instead of a jsdom render?
 *   - The project has no jsdom/testing-library setup and adding it would pull
 *     in a large dependency tree.
 *   - The false-positive root cause (QA MEDIUM #1) was a stale deploy, not a
 *     runtime behaviour; catching the string in source is sufficient and fast.
 *   - A Playwright e2e test (tests/e2e/upload-button-a11y.spec.ts) provides
 *     full runtime coverage including the rendered DOM.
 */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');
const { globSync } = require('node:fs');

// Components that contribute to the upload page's rendered button tree.
const UPLOAD_COMPONENT_FILES = [
  'components/upload/SubmitSection.tsx',
  'pages/Upload.tsx',
  'js/upload-react.tsx',
];

const ROOT = path.resolve(__dirname, '..', '..');

// ── Helpers ───────────────────────────────────────────────────────────────────

function readSource(relPath) {
  const abs = path.join(ROOT, relPath);
  assert.ok(fs.existsSync(abs), `Source file not found: ${relPath}`);
  return fs.readFileSync(abs, 'utf8');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('SubmitSection.tsx — submit button uses native disabled only (no aria-disabled)', () => {
  const src = readSource('components/upload/SubmitSection.tsx');

  assert.ok(
    !src.includes('aria-disabled'),
    'SubmitSection.tsx must not contain aria-disabled — use native disabled prop only',
  );

  // Positive assertion: native disabled must be present.
  assert.ok(
    src.includes('disabled={isDisabled}') || src.includes('disabled='),
    'SubmitSection.tsx must set native disabled on the submit button',
  );
});

test('Upload page and entry point — no aria-disabled on submit button', () => {
  for (const rel of ['pages/Upload.tsx', 'js/upload-react.tsx']) {
    const src = readSource(rel);
    assert.ok(
      !src.includes('aria-disabled'),
      `${rel} must not contain aria-disabled`,
    );
  }
});

test('No upload component introduces aria-disabled anywhere', () => {
  const componentDir = path.join(ROOT, 'components', 'upload');
  const files = fs.readdirSync(componentDir).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));

  assert.ok(files.length > 0, 'Expected upload component files to exist');

  const violators = files.filter(f => {
    const src = fs.readFileSync(path.join(componentDir, f), 'utf8');
    return src.includes('aria-disabled');
  });

  assert.deepEqual(
    violators,
    [],
    `These upload components contain aria-disabled (must use native disabled instead): ${violators.join(', ')}`,
  );
});
