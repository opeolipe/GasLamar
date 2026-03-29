#!/usr/bin/env node
/**
 * vendor.js — copy CDN library files from node_modules to js/vendor/
 *             and build Tailwind CSS from css/tailwind.input.css → css/tailwind.css
 * Run: npm run vendor
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'js', 'vendor');

fs.mkdirSync(VENDOR, { recursive: true });

const copies = [
  {
    src: path.join(ROOT, 'node_modules', 'docx', 'build', 'index.iife.js'),
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

// Build Tailwind CSS
const twBin = path.join(ROOT, 'node_modules', '.bin', 'tailwindcss');
if (!fs.existsSync(twBin)) {
  console.error('Missing: tailwindcss binary — run npm install first');
  process.exit(1);
}

const twInput  = path.join(ROOT, 'css', 'tailwind.input.css');
const twOutput = path.join(ROOT, 'css', 'tailwind.css');
const twConfig = path.join(ROOT, 'tailwind.config.js');

console.log('Building Tailwind CSS...');
execSync(
  `node "${twBin}" -c "${twConfig}" -i "${twInput}" -o "${twOutput}" --minify`,
  { stdio: 'inherit', cwd: ROOT }
);
const twSize = (fs.statSync(twOutput).size / 1024).toFixed(0);
console.log(`Tailwind CSS built → css/tailwind.css (${twSize} KB)`);
