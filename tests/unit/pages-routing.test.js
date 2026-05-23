const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');

function parseRedirects() {
  return readFileSync('_redirects', 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [from, to, status] = line.split(/\s+/);
      return { from, to, status };
    });
}

test('extensionless protected pages use server-side redirects', () => {
  const redirects = parseRedirects();

  assert.deepEqual(
    redirects.find((entry) => entry.from === '/hasil'),
    { from: '/hasil', to: '/upload.html?reason=no_session', status: '302' },
    '/hasil must not fall through to the static .html page with HTTP 200',
  );

  assert.deepEqual(
    redirects.find((entry) => entry.from === '/download'),
    { from: '/download', to: '/?reason=no_session', status: '302' },
    '/download must not fall through to the static .html page with HTTP 200',
  );
});

test('React session cleanup clears download routing flags', () => {
  const source = readFileSync('lib/sessionUtils.ts', 'utf8');

  for (const key of ['gaslamar_has_session', 'gaslamar_delivery']) {
    assert.match(
      source,
      new RegExp(`localStorage\\.removeItem\\(['"]${key}['"]\\)`),
      `${key} must be cleared so stale localStorage cannot bypass the synchronous download guard`,
    );
  }
});

test('React generation exhaustion clears download routing flag', () => {
  const source = readFileSync('hooks/useGenerateCV.ts', 'utf8');
  const exhaustionBlock = source.match(/if \(!credits_remaining \|\| credits_remaining <= 0\) \{[\s\S]*?\n\s*\}/);

  assert.ok(exhaustionBlock, 'missing exhausted-credit cleanup block');
  assert.match(
    exhaustionBlock[0],
    /localStorage\.removeItem\(['"]gaslamar_has_session['"]\)/,
    'exhausted sessions must clear gaslamar_has_session so stale localStorage cannot bypass download-guard.js',
  );
});

test('React email-token exchange strips token before success or failure handling', () => {
  const source = readFileSync('hooks/useDownloadSession.ts', 'utf8');
  const tokenExchangeBlock = source.match(/const res = await fetch\(`\$\{WORKER_URL\}\/exchange-token`[\s\S]*?if \(res\.ok\)/);

  assert.ok(tokenExchangeBlock, 'missing email-token exchange block');
  assert.match(
    tokenExchangeBlock[0],
    /history\.replaceState\(null, '', location\.pathname\);/,
    'download email token must be stripped from the URL before branching on exchange success/failure',
  );
});

test('CSP permits canonical and legacy Worker API origins used by deployed clients', () => {
  const headers = readFileSync('_headers', 'utf8');
  const cspLine = headers.split(/\r?\n/).find((line) => line.includes('Content-Security-Policy:'));

  assert.ok(cspLine, 'missing Content-Security-Policy header');
  assert.match(cspLine, /connect-src[^;\n]*https:\/\/gaslamar\.com/);
  assert.match(cspLine, /connect-src[^;\n]*https:\/\/api-staging\.gaslamar\.com/);
  assert.match(cspLine, /connect-src[^;\n]*https:\/\/gaslamar-worker\.carolineratuolivia\.workers\.dev/);
  assert.match(cspLine, /connect-src[^;\n]*https:\/\/gaslamar\.carolineratuolivia\.workers\.dev/);
  assert.match(cspLine, /connect-src[^;\n]*https:\/\/gaslamar-worker-staging\.carolineratuolivia\.workers\.dev/);
});
