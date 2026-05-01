/**
 * suggestEmailFix — lightweight typo-domain lookup for real-time inline hints.
 *
 * Returns a corrected email string if the domain looks like a known typo,
 * or null if the email looks fine (or is not yet a parseable address).
 *
 * This is intentionally a pure function with no side-effects so it can be
 * called on every keystroke without performance concerns.
 */

const TYPO_MAP: Record<string, string> = {
  // gmail.com typos
  'gmal.com':   'gmail.com',
  'gmai.com':   'gmail.com',
  'gmial.com':  'gmail.com',
  'gmail.co':   'gmail.com',
  'gamil.com':  'gmail.com',
  // yahoo.com typos
  'yahooo.com': 'yahoo.com',
  'yaho.com':   'yahoo.com',
  'yahoo.co':   'yahoo.com',
  // hotmail.com typos
  'hotmial.com': 'hotmail.com',
  'hotmal.com':  'hotmail.com',
  'hotmai.com':  'hotmail.com',
  // outlook.com typos
  'outlok.com':   'outlook.com',
  'outloook.com': 'outlook.com',
};

export function suggestEmailFix(email: string): string | null {
  const trimmed = email.trim();
  const atIdx   = trimmed.lastIndexOf('@');
  // Need at least one char before '@' and a domain with a dot after it
  if (atIdx < 1) return null;

  const local  = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1).toLowerCase();

  const corrected = TYPO_MAP[domain];
  if (!corrected || corrected === domain) return null;

  return `${local}@${corrected}`;
}
