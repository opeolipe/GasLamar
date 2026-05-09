#!/usr/bin/env node
/**
 * scripts/update-csp-hash.js
 *
 * Single source of truth for the hasil.html inline guard script:
 *   1. Read js/hasil-guard.js
 *   2. Minify with esbuild (same toolchain as all other bundles)
 *   3. Embed the minified output into hasil.html as the inline <script>
 *   4. Compute SHA-256 of the embedded content
 *   5. Update the sha256-* hash in _headers script-src
 *
 * Run automatically as part of `npm run build` so CI always produces
 * a consistent hasil.html + _headers pair. Manual edits to the hash or
 * the embedded inline script are intentionally overwritten.
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');

const ROOT         = path.resolve(__dirname, '..');
const GUARD_SRC    = path.join(ROOT, 'js', 'hasil-guard.js');
const HASIL_HTML   = path.join(ROOT, 'hasil.html');
const HEADERS_FILE = path.join(ROOT, '_headers');

(async () => {
  // 1. Read and minify the guard source
  const src = fs.readFileSync(GUARD_SRC, 'utf8');
  const { code } = await esbuild.transform(src, { minify: true, target: 'es2015' });
  const minified = code.trim();

  if (!minified) {
    console.error('[update-csp-hash] esbuild produced empty output — aborting');
    process.exit(1);
  }

  // 2. Embed into hasil.html — replace content between first <script>...</script> pair
  const html = fs.readFileSync(HASIL_HTML, 'utf8');
  const updated = html.replace(
    /(<script>)[\s\S]*?(<\/script>)/,
    `$1${minified}$2`
  );
  if (updated === html) {
    // Either no inline <script> found, or content unchanged
    const unchanged = html.includes(`<script>${minified}</script>`);
    if (!unchanged) {
      console.error('[update-csp-hash] Could not locate inline <script> in hasil.html — aborting');
      process.exit(1);
    }
  }
  fs.writeFileSync(HASIL_HTML, updated, 'utf8');

  // 3. Compute SHA-256 of the embedded script text
  const hash = 'sha256-' + crypto.createHash('sha256').update(minified, 'utf8').digest('base64');

  // 4. Update _headers — replace the existing sha256-* value in script-src
  const headers = fs.readFileSync(HEADERS_FILE, 'utf8');
  const updatedHeaders = headers.replace(/sha256-[A-Za-z0-9+/]+=/, hash);
  if (updatedHeaders === headers && !headers.includes(hash)) {
    console.error('[update-csp-hash] Could not locate sha256-* in _headers — aborting');
    process.exit(1);
  }
  fs.writeFileSync(HEADERS_FILE, updatedHeaders, 'utf8');

  console.log(`[update-csp-hash] Embedded guard script (${minified.length} chars)`);
  console.log(`[update-csp-hash] CSP hash updated → ${hash}`);
})().catch(e => {
  console.error('[update-csp-hash]', e.message);
  process.exit(1);
});
