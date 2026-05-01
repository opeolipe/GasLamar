import { validateEmail } from './emailValidation';

/**
 * Returns a corrected email if the domain looks like a known typo, null otherwise.
 * Delegates to validateEmail so both keystroke hints and submit-time checks are consistent.
 */
export function suggestEmailFix(email: string): string | null {
  const trimmed = email.trim();
  // Need a complete-looking address before suggesting (local@domain.tld)
  if (!trimmed.includes('@') || !trimmed.slice(trimmed.lastIndexOf('@') + 1).includes('.')) return null;
  return validateEmail(trimmed).suggestion ?? null;
}
