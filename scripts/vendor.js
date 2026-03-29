#!/usr/bin/env node
/**
 * vendor.js — copy CDN library files from node_modules to js/vendor/
 * Run: npm run vendor
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'js', 'vendor');

fs.mkdirSync(VENDOR, { recursive: true });

const copies = [
  {
    src: path.join(ROOT, 'node_modules', 'docx', 'build', 'index.js'),
    dst: path.join(VENDOR, 'docx.js'),
    label: 'docx@8.5.0',
  },
  {
    src: path.join(ROOT, 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js'),
    dst: path.join(VENDOR, 'jspdf.umd.min.js'),
    label: 'jspdf@2.5.1',
  },
];

let ok = true;
for (const { src, dst, label } of copies) {
  if (!fs.existsSync(src)) {
    console.error(`Missing: ${src} — run npm install first`);
    ok = false;
    continue;
  }
  fs.copyFileSync(src, dst);
  const size = (fs.statSync(dst).size / 1024).toFixed(0);
  console.log(`Copied ${label} → js/vendor/ (${size} KB)`);
}

if (!ok) process.exit(1);
console.log('Vendor files ready.');
