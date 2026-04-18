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
  'analytics-init': [
    'posthog-init.js',
    'analytics.js',
  ],
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
    'download-state.js',          // constants + mutable state + clearClientSessionData + getSecretHeaders + syncTierFromServer
    'download-ui.js',             // showState, showSessionError, setProgress, showDownloadReady …
    'download-file-utils.js',     // triggerDownload, buildCVFilename, sanitizeFilenamePart …
    'download-docx-pdf.js',       // CV_SECTION_HEADINGS, parseLines, generateDOCX, generatePDF
    'download-countdown.js',      // startCountdown
    'download-post-download.js',  // showPostDownloadActions, showInterviewTipsModal, closeInterviewTipsModal
    'download-api.js',            // startPolling, poll, heartbeat, updatePollUI
    'download-generation.js',     // fetchAndGenerateCV, generateCVContent, retryGeneration, generateForNewJob
    'download.js',                // downloadFile + init() IIFE — runs after all modules are defined
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

// ---------------------------------------------------------------------------
// Watch mode — run with: node scripts/build.js --watch  (or: npm run dev)
//
// Uses Node's built-in fs.watch with recursive: true, which is supported on
// Linux (inotify) and macOS (FSEvents). Intended for local development on
// Unix-like systems only; not guaranteed on Windows or network-mounted drives.
//
// Each changed file is matched against BUNDLES to rebuild only affected bundles
// in parallel (esbuild.transform is CPU-bound with no shared mutable state, so
// concurrent calls are safe). Changes that arrive while a rebuild is in progress
// are held in `pending` and processed in the next debounce cycle.
// ---------------------------------------------------------------------------
if (process.argv.includes('--watch')) {
  const DEBOUNCE_MS = 120;
  let timer = null;
  const pending = new Set();

  fs.watch(JS, { recursive: true }, (_, filename) => {
    if (!filename) return;
    // Ignore output files and non-JS files
    if (filename.startsWith('dist/') || !filename.endsWith('.js')) return;
    pending.add(filename);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const changed = [...pending];
      pending.clear();
      // Find bundles that include any of the changed files
      const names = Object.entries(BUNDLES)
        .filter(([, files]) => changed.some(f => files.includes(f)))
        .map(([name]) => name);
      if (names.length === 0) return;
      const t0 = Date.now();
      try {
        await Promise.all(names.map(n => buildBundle(n, BUNDLES[n])));
        console.log(`[watch] rebuilt ${names.join(', ')} in ${Date.now() - t0}ms`);
      } catch (e) {
        console.error(`[watch] build error: ${e.message}`);
      }
    }, DEBOUNCE_MS);
  });

  console.log('[watch] watching js/*.js — Ctrl-C to stop');
}
