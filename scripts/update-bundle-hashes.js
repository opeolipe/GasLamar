#!/usr/bin/env node
/**
 * scripts/update-bundle-hashes.js
 *
 * After all JS bundles are built, replace the ?v= query string on every
 * <script src="js/dist/...bundle.js?v=..."> reference in HTML files with the
 * first 8 hex chars of the bundle's SHA-256 content hash.
 *
 * This ensures browsers re-fetch only bundles that actually changed on each
 * deploy, rather than serving stale code from cache.
 *
 * Run automatically as the last step of `npm run build`.
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

const HTML_FILES = [
  'index.html',
  'upload.html',
  'hasil.html',
  'analyzing.html',
  'download.html',
  'access.html',
];

const hashCache = new Map();

function contentHash(filePath) {
  if (hashCache.has(filePath)) return hashCache.get(filePath);
  const buf  = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
  hashCache.set(filePath, hash);
  return hash;
}

let totalUpdated = 0;

for (const htmlFile of HTML_FILES) {
  const htmlPath = path.join(ROOT, htmlFile);
  if (!fs.existsSync(htmlPath)) continue;

  let html    = fs.readFileSync(htmlPath, 'utf8');
  let changed = false;

  // Match: src="js/dist/<anything>.bundle.js?v=<anything>"
  html = html.replace(
    /src="(js\/dist\/[^"?]+\.bundle\.js)\?v=[^"]*"/g,
    (_, bundleRef) => {
      const abs = path.join(ROOT, bundleRef);
      if (!fs.existsSync(abs)) {
        console.warn(`[update-bundle-hashes] Warning: bundle not found: ${bundleRef}`);
        return _;
      }
      changed = true;
      return `src="${bundleRef}?v=${contentHash(abs)}"`;
    }
  );

  if (changed) {
    fs.writeFileSync(htmlPath, html, 'utf8');
    totalUpdated++;
    console.log(`[update-bundle-hashes] Updated ${htmlFile}`);
  }
}

console.log(`[update-bundle-hashes] Done — ${totalUpdated} file(s) updated`);
