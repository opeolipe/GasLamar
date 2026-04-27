#!/usr/bin/env node
'use strict';

const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

const ENTRIES = [
  { in: 'js/home-react.tsx',      out: 'js/dist/home-react.bundle'      },
  { in: 'js/upload-react.tsx',    out: 'js/dist/upload-react.bundle'    },
  { in: 'js/analyzing-react.tsx', out: 'js/dist/analyzing-react.bundle' },
  { in: 'js/hasil-react.tsx',     out: 'js/dist/hasil-react.bundle'     },
  { in: 'js/download-react.tsx', out: 'js/dist/download-react.bundle'  },
];

const ALIASES = {
  '@': ROOT,
};

(async () => {
  console.log('Building React bundles...');
  const t0 = Date.now();

  await Promise.all(ENTRIES.map(({ in: entry, out }) =>
    esbuild.build({
      entryPoints: [path.join(ROOT, entry)],
      bundle: true,
      minify: true,
      target: 'es2017',
      format: 'iife',
      outfile: path.join(ROOT, out + '.js'),
      jsx: 'automatic',
      alias: Object.fromEntries(
        Object.entries(ALIASES).map(([k, v]) => [k, v])
      ),
      define: {
        'process.env.NODE_ENV': '"production"',
        'IS_SANDBOX': process.env.GASLAMAR_IS_SANDBOX === 'true' ? 'true' : 'false',
      },
    }).then(() => {
      const fs = require('fs');
      const size = (fs.statSync(path.join(ROOT, out + '.js')).size / 1024).toFixed(1);
      console.log(`  ${entry.padEnd(25)} → ${out}.js (${size} KB)`);
    })
  ));

  console.log(`Done in ${Date.now() - t0}ms.`);
})().catch(e => { console.error(e.message); process.exit(1); });
