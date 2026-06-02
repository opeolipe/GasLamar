#!/usr/bin/env node
/**
 * scripts/verify-staging-bundle.js
 *
 * Run after a Cloudflare Pages staging deploy to confirm the live pages are
 * serving bundles built from the current commit — not a stale deployment.
 *
 * Strategy: the build pipeline embeds content-hash fingerprints in every
 * ?v= query string (update-bundle-hashes.js). This script:
 *   1. Reads expected fingerprints from local HTML files (just built).
 *   2. Fetches each deployed HTML page from the staging URL.
 *   3. Compares the ?v= values for every bundle referenced in each file.
 *   4. Asserts that each page loads its own dedicated bundle (catches the
 *      "hasil.html is a copy of upload.html" class of stale-deploy bug).
 *
 * Usage:
 *   STAGING_URL=https://staging.gaslamar.pages.dev node scripts/verify-staging-bundle.js
 *
 * Exit codes: 0 = all checks pass, 1 = any mismatch or fetch failure.
 */
'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const STAGING_URL = process.env.STAGING_URL;
if (!STAGING_URL) {
  console.error('[verify-staging-bundle] STAGING_URL env var is required');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');

// Pages to verify: [html filename, expected dedicated bundle (must be present)]
const PAGES = [
  { file: 'upload.html',    ownBundle: 'js/dist/upload-react.bundle.js' },
  { file: 'hasil.html',     ownBundle: 'js/dist/hasil-react.bundle.js'  },
  { file: 'analyzing.html', ownBundle: 'js/dist/analyzing-react.bundle.js' },
  { file: 'download.html',  ownBundle: 'js/dist/download-react.bundle.js' },
  { file: 'index.html',     ownBundle: 'js/dist/home-react.bundle.js'   },
];

// Bundles that must NOT appear in a page other than their owner.
// Catches identical-file bugs (e.g. hasil.html loading upload-react.bundle.js).
const EXCLUSIVE_BUNDLES = [
  'js/dist/upload-react.bundle.js',
  'js/dist/hasil-react.bundle.js',
  'js/dist/analyzing-react.bundle.js',
  'js/dist/download-react.bundle.js',
  'js/dist/home-react.bundle.js',
];

function extractBundleVersions(html) {
  const map = {};
  const re = /src="(js\/dist\/[^"?]+\.bundle\.js)\?v=([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    map[m[1]] = m[2];
  }
  return map;
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const base = STAGING_URL.replace(/\/$/, '');
  let fail = false;

  for (const { file, ownBundle } of PAGES) {
    const localPath = path.join(ROOT, file);

    if (!fs.existsSync(localPath)) {
      console.warn(`[verify-staging-bundle] SKIP ${file} — not found locally`);
      continue;
    }

    const localHtml  = fs.readFileSync(localPath, 'utf8');
    const localVers  = extractBundleVersions(localHtml);

    if (Object.keys(localVers).length === 0) {
      console.error(`[verify-staging-bundle] ${file}: no bundle refs found locally — run npm run build first`);
      fail = true;
      continue;
    }

    const url = `${base}/${file}`;
    console.log(`\n[${file}] Fetching ${url}`);

    let remoteHtml;
    try {
      remoteHtml = await fetchPage(url);
    } catch (err) {
      console.error(`  ✗ Fetch failed: ${err.message}`);
      fail = true;
      continue;
    }

    const remoteVers = extractBundleVersions(remoteHtml);

    // 1. Each bundle fingerprint must match the local build.
    for (const [bundle, expectedV] of Object.entries(localVers)) {
      const deployedV = remoteVers[bundle];
      if (deployedV === expectedV) {
        console.log(`  ✓ ${bundle}?v=${expectedV}`);
      } else {
        console.error(`  ✗ ${bundle} — expected ?v=${expectedV}, got ?v=${deployedV ?? '(missing)'}`);
        fail = true;
      }
    }

    // 2. The page must reference its own dedicated bundle.
    if (!remoteVers[ownBundle]) {
      console.error(`  ✗ STRUCTURAL: ${file} must reference ${ownBundle} — not found in deployed page`);
      fail = true;
    } else {
      console.log(`  ✓ own bundle present: ${ownBundle}`);
    }

    // 3. The page must NOT reference another page's exclusive bundle.
    for (const foreignBundle of EXCLUSIVE_BUNDLES) {
      if (foreignBundle === ownBundle) continue;
      if (remoteVers[foreignBundle]) {
        console.error(
          `  ✗ STRUCTURAL: ${file} must NOT reference ${foreignBundle} — this indicates ` +
          `${file} is a stale copy of another page's HTML`
        );
        fail = true;
      }
    }
  }

  console.log('');
  if (fail) {
    console.error('[verify-staging-bundle] FAIL — one or more staging pages are stale or misconfigured.');
    console.error('This means the Pages deploy did not propagate, or the build artifact is wrong.');
    process.exit(1);
  }

  console.log('[verify-staging-bundle] PASS — all staging pages match the current build.');
}

main();
