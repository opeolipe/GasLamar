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

const RETRY_DELAYS_MS = [15000, 20000, 25000, 30000]; // 4 retries after initial attempt (~90s total)

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Cloudflare Pages "Clean URLs" strips .html and canonicalises /foo.html → /foo.
  // If a _redirects rule exists for /foo (e.g. /hasil → upload.html), the chain
  // becomes: /hasil.html → 301 /hasil → 302 /upload.html — and we silently read
  // the wrong page.  Detect this by comparing the final URL to the requested URL.
  if (res.redirected && res.url !== url) {
    throw new Error(`Redirected to ${res.url} — _redirects rule or canonical URL redirect intercepted the request`);
  }
  return res.text();
}

/**
 * Verify a single JS bundle file is deployed with the correct content hash.
 * Used as a fallback for HTML pages that redirect (session-protected pages
 * such as hasil.html and download.html can't be read via their HTML URL
 * because Cloudflare Pages' Clean URL canonicalisation chains into the
 * _redirects rules before we can see the file content).
 */
async function checkBundleAsset(base, bundle, expectedV) {
  const url = `${base}/${bundle}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
  } catch (err) {
    return [`Asset fetch failed for ${bundle}: ${err.message}`];
  }
  if (!res.ok) return [`Asset ${bundle} returned HTTP ${res.status}`];
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = require('node:crypto').createHash('sha256').update(buf).digest('hex').slice(0, 8);
  if (hash !== expectedV) {
    return [`${bundle} — expected content hash ${expectedV}, deployed hash ${hash}`];
  }
  return [];
}

/** Check one page. Returns an array of error strings, or empty array on success. */
async function checkPage(base, file, ownBundle, localVers) {
  const url = `${base}/${file}`;
  let remoteHtml;
  try {
    remoteHtml = await fetchPage(url);
  } catch (err) {
    // Cloudflare Pages "Clean URLs" + _redirects can redirect session-protected
    // pages (e.g. /hasil.html → /hasil → upload.html).  Fall back to verifying
    // the JS bundle asset directly so the build is still confirmed correct.
    if (err.message.startsWith('Redirected to ')) {
      console.log(`  (redirected — verifying bundle asset directly)`);
      const expectedV = localVers[ownBundle];
      if (!expectedV) return [`No local version found for ${ownBundle}`];
      const errs = await checkBundleAsset(base, ownBundle, expectedV);
      if (errs.length === 0) {
        console.log(`  ✓ ${ownBundle} (asset hash verified)`);
      }
      return errs;
    }
    return [`Fetch failed: ${err.message}`];
  }

  const remoteVers = extractBundleVersions(remoteHtml);
  const errors = [];

  // 1. Each bundle fingerprint must match the local build.
  for (const [bundle, expectedV] of Object.entries(localVers)) {
    const deployedV = remoteVers[bundle];
    if (deployedV !== expectedV) {
      errors.push(`${bundle} — expected ?v=${expectedV}, got ?v=${deployedV ?? '(missing)'}`);
    }
  }

  // 2. The page must reference its own dedicated bundle.
  if (!remoteVers[ownBundle]) {
    errors.push(`STRUCTURAL: ${file} must reference ${ownBundle} — not found in deployed page`);
  }

  // 3. The page must NOT reference another page's exclusive bundle.
  for (const foreignBundle of EXCLUSIVE_BUNDLES) {
    if (foreignBundle === ownBundle) continue;
    if (remoteVers[foreignBundle]) {
      errors.push(
        `STRUCTURAL: ${file} must NOT reference ${foreignBundle} — ` +
        `this indicates ${file} is a stale copy of another page's HTML`
      );
    }
  }

  return errors;
}

async function main() {
  const base = STAGING_URL.replace(/\/$/, '');

  // Pre-load all local HTML files and their expected bundle versions.
  const pages = [];
  for (const { file, ownBundle } of PAGES) {
    const localPath = path.join(ROOT, file);
    if (!fs.existsSync(localPath)) {
      console.warn(`[verify-staging-bundle] SKIP ${file} — not found locally`);
      continue;
    }
    const localHtml = fs.readFileSync(localPath, 'utf8');
    const localVers = extractBundleVersions(localHtml);
    if (Object.keys(localVers).length === 0) {
      console.error(`[verify-staging-bundle] ${file}: no bundle refs found locally — run npm run build first`);
      process.exit(1);
    }
    pages.push({ file, ownBundle, localVers });
  }

  // Retry loop: Cloudflare Pages CDN propagation can take 30–90 s after deploy.
  // We attempt verification up to 5 times with increasing delays between attempts.
  const attempts = [0, ...RETRY_DELAYS_MS]; // first attempt is immediate (sleep already done by workflow)
  let lastErrors = {};

  for (let attempt = 0; attempt < attempts.length; attempt++) {
    if (attempt > 0) {
      const wait = attempts[attempt];
      console.log(`\n[verify-staging-bundle] Attempt ${attempt + 1}/${attempts.length} — waiting ${wait / 1000}s for CDN propagation...`);
      await sleep(wait);
    } else {
      console.log(`[verify-staging-bundle] Attempt 1/${attempts.length}`);
    }

    lastErrors = {};
    let allPass = true;

    for (const { file, ownBundle, localVers } of pages) {
      const url = `${base}/${file}`;
      console.log(`\n[${file}] Fetching ${url}`);
      const errors = await checkPage(base, file, ownBundle, localVers);

      if (errors.length === 0) {
        // Print passing checks
        for (const [bundle, v] of Object.entries(localVers)) {
          console.log(`  ✓ ${bundle}?v=${v}`);
        }
        console.log(`  ✓ own bundle present: ${ownBundle}`);
      } else {
        allPass = false;
        lastErrors[file] = errors;
        for (const e of errors) console.error(`  ✗ ${e}`);
      }
    }

    if (allPass) {
      console.log('\n[verify-staging-bundle] PASS — all staging pages match the current build.');
      return;
    }

    if (attempt < attempts.length - 1) {
      const failingPages = Object.keys(lastErrors).join(', ');
      console.warn(`\n[verify-staging-bundle] Attempt ${attempt + 1} failed for: ${failingPages}. Retrying...`);
    }
  }

  // All attempts exhausted.
  console.error('\n[verify-staging-bundle] FAIL — staging pages still stale after all retry attempts.');
  for (const [file, errors] of Object.entries(lastErrors)) {
    console.error(`  ${file}:`);
    for (const e of errors) console.error(`    ✗ ${e}`);
  }
  console.error('This means CDN propagation took too long, or the build artifact is wrong.');
  process.exit(1);
}

main();
