#!/usr/bin/env node
/**
 * scripts/check-cache-versions.js
 *
 * CI guard: fails if worker/src/pipeline/ or worker/src/prompts/ files changed
 * without a corresponding bump to the cache version constants:
 *
 *   - ANALYSIS_CACHE_VERSION in worker/src/cacheVersions.js
 *     (required when any pipeline/ or prompts/ file changes)
 *
 *   - EXTRACT_CACHE_VERSION in worker/src/cacheVersions.js
 *     (required specifically when pipeline/extract.js or prompts/extract.js changes)
 *
 *   - GEN_KEY_PREFIX_ID / GEN_KEY_PREFIX_EN in worker/src/cacheVersions.js
 *     (required when any worker/src/prompts/tailor*.js file changes)
 *
 * Compares HEAD against HEAD~1. If there is no parent commit the check is
 * skipped (initial commit on a fresh repo).
 *
 * Run via `npm run check:cache` or as a CI step after worker tests.
 */

'use strict';

const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');

const ROOT = path.resolve(__dirname, '..');

// ---- helpers ----

function gitShow(ref, filePath) {
  try {
    return execSync(`git show ${ref}:${filePath}`, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  } catch (_) {
    return null; // file didn't exist at that ref
  }
}

function extract(content, varName) {
  if (!content) return null;
  const m = content.match(new RegExp(`${varName}\\s*=\\s*'([^']+)'`));
  return m ? m[1] : null;
}

// ---- get changed files ----

let changedFiles;
try {
  changedFiles = execSync('git diff --name-only HEAD~1 HEAD', { cwd: ROOT })
    .toString().trim().split('\n').filter(Boolean);
} catch (_) {
  console.log('[check-cache-versions] No parent commit — skipping check');
  process.exit(0);
}

const pipelineOrPromptsChanged = changedFiles.some(f =>
  f.startsWith('worker/src/pipeline/') || f.startsWith('worker/src/prompts/')
);
const extractSpecificChanged = changedFiles.some(f =>
  f === 'worker/src/pipeline/extract.js' || f === 'worker/src/prompts/extract.js'
);
const tailorPromptsChanged = changedFiles.some(f =>
  /^worker\/src\/prompts\/tailor/.test(f)
);

if (!pipelineOrPromptsChanged) {
  console.log('[check-cache-versions] No pipeline/prompts changes — nothing to verify');
  process.exit(0);
}

// ---- read current + previous constants ----

const cacheVersionsRel = 'worker/src/cacheVersions.js';

const cacheVersions = fs.readFileSync(path.join(ROOT, cacheVersionsRel), 'utf8');
const prevCacheVersions = gitShow('HEAD~1', cacheVersionsRel);

let failed = false;

// ---- ANALYSIS_CACHE_VERSION ----

const curAnalysis  = extract(cacheVersions, 'ANALYSIS_CACHE_VERSION');
const prevAnalysis_ = extract(prevCacheVersions, 'ANALYSIS_CACHE_VERSION');

if (curAnalysis === prevAnalysis_) {
  console.error(
    `[check-cache-versions] FAIL: pipeline/prompts changed but ANALYSIS_CACHE_VERSION is still '${curAnalysis}'.`
  );
  console.error('  → Bump ANALYSIS_CACHE_VERSION in worker/src/cacheVersions.js');
  failed = true;
} else {
  console.log(`[check-cache-versions] OK: ANALYSIS_CACHE_VERSION ${prevAnalysis_} → ${curAnalysis}`);
}

// ---- EXTRACT_CACHE_VERSION ----

if (extractSpecificChanged) {
  const curExtract  = extract(cacheVersions, 'EXTRACT_CACHE_VERSION');
  const prevExtract = extract(prevCacheVersions, 'EXTRACT_CACHE_VERSION');

  if (curExtract === prevExtract) {
    console.error(
      `[check-cache-versions] FAIL: extract pipeline/prompts changed but EXTRACT_CACHE_VERSION is still '${curExtract}'.`
    );
    console.error('  → Bump EXTRACT_CACHE_VERSION in worker/src/cacheVersions.js');
    failed = true;
  } else {
    console.log(`[check-cache-versions] OK: EXTRACT_CACHE_VERSION ${prevExtract} → ${curExtract}`);
  }
}

// ---- GEN_KEY_PREFIX ----

if (tailorPromptsChanged) {
  const curPrefix  = extract(cacheVersions, 'GEN_KEY_PREFIX_ID');
  const prevPrefix = extract(prevCacheVersions, 'GEN_KEY_PREFIX_ID');

  if (curPrefix === prevPrefix) {
    console.error(
      `[check-cache-versions] FAIL: tailor prompts changed but GEN_KEY_PREFIX_ID is still '${curPrefix}'.`
    );
    console.error('  → Bump GEN_KEY_PREFIX_ID and GEN_KEY_PREFIX_EN in worker/src/cacheVersions.js');
    failed = true;
  } else {
    console.log(`[check-cache-versions] OK: GEN_KEY_PREFIX_ID ${prevPrefix} → ${curPrefix}`);
  }
}

if (failed) {
  console.error('[check-cache-versions] Stale cache versions will serve old results. Fix before deploying.');
  process.exit(1);
}

console.log('[check-cache-versions] All cache versions properly bumped');
