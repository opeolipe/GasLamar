#!/usr/bin/env node
/**
 * scripts/verify-staging-bundle.js
 *
 * Run after a Cloudflare Pages staging deploy to confirm the live page is
 * serving bundles built from the current commit — not a stale deployment.
 *
 * Strategy: the build pipeline embeds content-hash fingerprints in every
 * ?v= query string (update-bundle-hashes.js). This script:
 *   1. Reads the expected fingerprint from the local upload.html (just built).
 *   2. Fetches the deployed upload.html from the staging URL.
 *   3. Compares the ?v= values for each bundle referenced in the file.
 *
 * Usage:
 *   STAGING_URL=https://staging.gaslamar.pages.dev node scripts/verify-staging-bundle.js
 *
 * Exit codes: 0 = all fingerprints match, 1 = mismatch or fetch failure.
 */
'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const STAGING_URL = process.env.STAGING_URL;
if (!STAGING_URL) {
  console.error('[verify-staging-bundle] STAGING_URL env var is required');
  process.exit(1);
}

const LOCAL_HTML = path.join(__dirname, '..', 'upload.html');

// Extract all  src="js/dist/foo.bundle.js?v=XXXX"  entries from an HTML string.
function extractBundleVersions(html) {
  const map = {};
  const re = /src="(js\/dist\/[^"?]+\.bundle\.js)\?v=([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    map[m[1]] = m[2];
  }
  return map;
}

async function main() {
  const localHtml = fs.readFileSync(LOCAL_HTML, 'utf8');
  const localVersions = extractBundleVersions(localHtml);

  if (Object.keys(localVersions).length === 0) {
    console.error('[verify-staging-bundle] No bundle references found in local upload.html — run npm run build first');
    process.exit(1);
  }

  const targetUrl = `${STAGING_URL.replace(/\/$/, '')}/upload.html`;
  console.log(`[verify-staging-bundle] Fetching ${targetUrl}`);

  let remoteHtml;
  try {
    const res = await fetch(targetUrl, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    remoteHtml = await res.text();
  } catch (err) {
    console.error(`[verify-staging-bundle] Failed to fetch staging page: ${err.message}`);
    process.exit(1);
  }

  const remoteVersions = extractBundleVersions(remoteHtml);

  let allMatch = true;
  for (const [bundle, expectedV] of Object.entries(localVersions)) {
    const deployedV = remoteVersions[bundle];
    if (deployedV === expectedV) {
      console.log(`  ✓ ${bundle}?v=${expectedV}`);
    } else {
      console.error(`  ✗ ${bundle} — expected ?v=${expectedV}, got ?v=${deployedV ?? '(missing)'}`);
      allMatch = false;
    }
  }

  if (!allMatch) {
    console.error('\n[verify-staging-bundle] FAIL — staging is serving stale bundles.');
    console.error('This means the Pages deploy did not propagate, or the build artifact is wrong.');
    process.exit(1);
  }

  console.log('\n[verify-staging-bundle] PASS — all staging bundles match current build.');
}

main();
