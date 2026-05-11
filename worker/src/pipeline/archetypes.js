/**
 * Archetype detection — keyword map from job title to role category.
 * Update this list as new role titles emerge; no code changes needed elsewhere.
 *
 * Order matters: earlier entries win on ambiguous titles.
 * Each entry: [regex, archetype_string]
 */
export const ARCHETYPE_MAP = [
  [/fresh\s*grad|trainee|magang|intern|graduate\s*program/i,                    'Fresh Graduate (trainee)'],
  [/admin|administrasi|general\s*affair|\bga\b|office\s*(manager|staff|boy|girl)/i, 'Administrasi/GA'],
  [/marketing|digital\s*market|\bsales\b|business\s*dev|\bbd\b|account\s*(exec|manager)|brand\s*(manager|strategist)/i, 'Marketing/Sales'],
  [/financ|keuangan|accounting|akuntan|controller|tax\b|pajak|audit/i,           'Finance/Akuntansi'],
  [/software|engineer|developer|programmer|\bit\b|data\s*(analyst|engineer|scientist|science)|devops|frontend|back[-\s]?end|fullstack|mobile\s*dev/i, 'IT/Software'],
  [/\bhrd\b|\bhrga\b|\bhr\b|human\s*resource|rekrut|talent|people\s*ops/i,      'HRD'],
  [/logistik|supply\s*chain|operasional|warehouse|gudang|procurement|purchasing/i, 'Operasional/Logistik'],
  [/customer\s*service|\bcs\b|call\s*center|technical\s*support|helpdesk|cabin\s*crew|flight\s*attendant|pramugari|pramugara|aviasi\b/i, 'Customer Service'],
  [/manager|manajer|direktur|kepala\s|head\s*of|\blead\b|supervisor|\bvp\b|chief/i, 'Manajemen/Leader'],
];

export const VALID_ARCHETYPES = [
  'Administrasi/GA', 'Marketing/Sales', 'Finance/Akuntansi', 'IT/Software',
  'HRD', 'Operasional/Logistik', 'Customer Service', 'Manajemen/Leader',
  'Fresh Graduate (trainee)', 'Lainnya',
];

/**
 * Returns the archetype string for a given job title.
 * Falls back to 'Lainnya' for unrecognised titles.
 */
export function detectArchetype(judulRole) {
  const title = (judulRole || '').toLowerCase();
  for (const [pattern, archetype] of ARCHETYPE_MAP) {
    if (pattern.test(title)) return archetype;
  }
  return 'Lainnya';
}
