#!/usr/bin/env node
/**
 * scripts/build.js — GasLamar JS bundler
 *
 * Concatenates per-page JS files in the same order they appeared as
 * <script> tags, then minifies the combined source with esbuild.
 * Outputs to js/dist/<page>.bundle.js.
 *
 * No ES-module refactoring needed — all files use shared globals
 * (window.Analytics, window.WORKER_URL, etc.) and are concatenated
 * in dependency order, exactly as the browser would have executed them.
 *
 * Excluded from bundles:
 *   - hasil-guard.js  → must run synchronously mid-body; kept as its own <script>
 *   - js/vendor/*     → already-minified UMD builds; too large to re-bundle
 *   - Cloudflare Insights → external CDN, already defer, no benefit
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const JS   = path.join(ROOT, 'js');
const OUT  = path.join(JS, 'dist');

fs.mkdirSync(OUT, { recursive: true });

/**
 * File lists — must match the <script> tag order in each HTML file.
 * posthog-init.js is always first (was in <head> on every page).
 * config.js must precede analytics.js (sets WORKER_URL used by analytics stubs).
 */
const BUNDLES = {
  index: [
    'posthog-init.js',
    'analytics.js',
    'index-page.js',
  ],
  upload: [
    'posthog-init.js',
    'config.js',
    'analytics.js',
    'upload.js',
    'upload-page.js',
  ],
  hasil: [
    // hasil-guard.js intentionally excluded — kept as standalone <script>
    'posthog-init.js',
    'config.js',
    'analytics.js',
    'scoring.js',
    'payment.js',
    'hasil-page.js',
  ],
  download: [
    'posthog-init.js',
    'config.js',
    'analytics.js',
    'download.js',
    'download-page.js',
  ],
  analyzing: [
    'posthog-init.js',
    'config.js',
    'analytics.js',
    'analyzing-page.js',
  ],
};

async function buildBundle(name, files) {
  const combined = files
    .map(f => {
      const src = path.join(JS, f);
      if (!fs.existsSync(src)) throw new Error(`Missing source file: ${src}`);
      return `/* ---- ${f} ---- */\n${fs.readFileSync(src, 'utf8')}`;
    })
    .join('\n\n');

  const { code } = await esbuild.transform(combined, {
    minify:  true,
    target:  'es2017',  // Safari 14+, Chrome 61+, Firefox 55+
    loader:  'js',
    charset: 'utf8',
  });

  const outFile = path.join(OUT, `${name}.bundle.js`);
  fs.writeFileSync(outFile, code);

  const origKB = (Buffer.byteLength(combined, 'utf8') / 1024).toFixed(1);
  const minKB  = (Buffer.byteLength(code,     'utf8') / 1024).toFixed(1);
  const pct    = (100 - (code.length / combined.length) * 100).toFixed(0);
  console.log(`  ${name.padEnd(10)} ${origKB.padStart(6)} KB → ${minKB.padStart(6)} KB  (-${pct}%)`);
}

(async () => {
  console.log('Building JS bundles...');
  const t0 = Date.now();
  await Promise.all(
    Object.entries(BUNDLES).map(([name, files]) => buildBundle(name, files))
  );
  console.log(`Done in ${Date.now() - t0}ms. Output: js/dist/`);
})().catch(e => { console.error(e.message); process.exit(1); });
