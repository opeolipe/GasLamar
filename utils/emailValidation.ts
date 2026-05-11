export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COMMON_TYPOS: Record<string, string> = {
  'gmal.com':    'gmail.com',
  'gmial.com':   'gmail.com',
  'gnail.com':   'gmail.com',
  'gmail.con':   'gmail.com',
  'yaho.com':    'yahoo.com',
  'yahooo.com':  'yahoo.com',
  'hotnail.com': 'hotmail.com',
  'outlok.com':  'outlook.com',
};

const CANONICAL_DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com'];

export const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', '10minutemail.com',
]);

export interface EmailValidation {
  valid:        boolean;
  error:        string | null;
  suggestion:   string | null;
  isDisposable: boolean;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function findTypoDomain(domain: string): string | null {
  if (COMMON_TYPOS[domain]) return COMMON_TYPOS[domain];
  for (const canonical of CANONICAL_DOMAINS) {
    if (levenshtein(domain, canonical) === 1) return canonical;
  }
  return null;
}

export function validateEmail(raw: string): EmailValidation {
  const email      = raw.trim();
  const normalized = email.toLowerCase();

  if (!email) {
    return { valid: false, error: 'Email diperlukan untuk melanjutkan.', suggestion: null, isDisposable: false };
  }

  if (!EMAIL_REGEX.test(email)) {
    return { valid: false, error: 'Format email tidak valid. Contoh: nama@domain.com', suggestion: null, isDisposable: false };
  }

  const atIdx     = normalized.indexOf('@');
  const localPart = email.slice(0, email.indexOf('@'));
  const domain    = normalized.slice(atIdx + 1);

  const corrected = findTypoDomain(domain);
  if (corrected && corrected !== domain) {
    return {
      valid:        false,
      error:        'Sepertinya ada typo di email kamu.',
      suggestion:   `${localPart}@${corrected}`,
      isDisposable: false,
    };
  }

  return {
    valid:        true,
    error:        null,
    suggestion:   null,
    isDisposable: DISPOSABLE_DOMAINS.has(domain),
  };
}
