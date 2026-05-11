/**
 * Archetype detection — keyword map from job title to role category.
 * Update this list as new role titles emerge; no code changes needed elsewhere.
 *
 * Order matters: earlier entries win on ambiguous titles.
 * Each entry: [regex, archetype_string]
 *
 * Key ordering rules:
 *   - Fresh Graduate first (magang/intern/trainee can appear in any role title)
 *   - Teknik/Manufaktur before IT/Software (prevents "Mechanical Engineer" hitting IT)
 *   - Kreatif/Desain before Marketing/Sales (Content Creator is design, not marketing)
 *   - Manajemen/Leader last (manager/lead/supervisor appears in every senior role)
 */
export const ARCHETYPE_MAP = [
  // ── Trainee / entry level ────────────────────────────────────────────────────
  [/fresh\s*grad|trainee|magang|intern|graduate\s*program/i,
    'Fresh Graduate (trainee)'],

  // ── Support / office ─────────────────────────────────────────────────────────
  [/admin|administrasi|general\s*affair|\bga\b|office\s*(manager|staff|boy|girl)|sekretaris|secretary/i,
    'Administrasi/GA'],

  // ── Engineering / manufacturing (checked BEFORE IT/Software to avoid false hits) ──
  [/teknik\s*(sipil|mesin|elektro|kimia|industri|lingkungan|geodesi|perkapalan)|civil\s*eng|mechanical\s*eng|electrical\s*eng|chemical\s*eng|industrial\s*eng|manufaktur|manufacturing|produksi|production|quality\s*(control|assurance|engineer)|plant\s*(manager|operator|engineer)|maintenance\s*(eng|tech|supervisor|manager)|process\s*eng|field\s*eng|structural\s*eng|welding|fabricat/i,
    'Teknik/Manufaktur'],

  // ── Marketing / sales ────────────────────────────────────────────────────────
  [/marketing|digital\s*market|\bsales\b|business\s*dev|\bbd\b|account\s*(exec|manager|officer)|brand\s*(manager|strategist)|penjualan|pemasaran|copywriter|community\s*(manager|lead|officer)|growth\s*(hacker|manager)|partnership/i,
    'Marketing/Sales'],

  // ── Finance / accounting ─────────────────────────────────────────────────────
  [/financ|keuangan|accounting|akuntan|controller|tax\b|pajak|audit|treasurer|treasury|credit\s*analyst|risk\s*analyst|budgeting|cost\s*accountant/i,
    'Finance/Akuntansi'],

  // ── IT / software (bare "engineer" removed — too ambiguous across disciplines) ──
  [/software|developer|programmer|\bit\b|data\s*(analyst|engineer|scientist|science)|devops|frontend|back[-\s]?end|fullstack|mobile\s*dev|network\s*(engineer|admin|specialist)|cloud\s*(architect|engineer)|system\s*analyst|cybersecurity|cyber\s*security|machine\s*learning|product\s*(manager|owner)|qa\s*engineer|test\s*(engineer|automation)|scrum\s*master|agile\s*coach/i,
    'IT/Software'],

  // ── Human resources ──────────────────────────────────────────────────────────
  [/\bhrd\b|\bhrga\b|\bhr\b|human\s*resource|rekrut|talent|people\s*ops|compensation\s*&?\s*benefit|\bc&b\b|learning\s*&?\s*development|\bl&d\b/i,
    'HRD'],

  // ── Operations / logistics ───────────────────────────────────────────────────
  [/logistik|supply\s*chain|operasional|warehouse|gudang|procurement|purchasing|ekspedisi|fleet\s*manag|distribusi|distribution|inventory\s*(manager|staff|control)/i,
    'Operasional/Logistik'],

  // ── Creative / design (before Customer Service to catch "content creator") ────
  [/desain|designer|graphic|ui[\s\/\-]ux|ux\s*design|fotografer|photographer|videografer|videographer|creative\s*(director|lead|staff|manager)|content\s*creator|animator|illustrator|motion\s*graphic|art\s*director/i,
    'Kreatif/Desain'],

  // ── Healthcare / medical ─────────────────────────────────────────────────────
  [/dokter|perawat|\bnurse\b|apoteker|\bfarmasi\b|fisioterapi|bidan|radiologi|medical\s*(officer|staff|representative)|tenaga\s*medis|kesehatan\s*masyarakat|laboratorium\s*medis|analis\s*kesehatan/i,
    'Kesehatan'],

  // ── Education / training ─────────────────────────────────────────────────────
  [/\bguru\b|\bteacher\b|\bdosen\b|\btrainer\b|instruktur|\btutor\b|pengajar|pendidik|fasilitator\s*training|kepala\s*sekolah|curriculum\s*develop/i,
    'Pendidikan/Pelatihan'],

  // ── Hospitality / F&B ────────────────────────────────────────────────────────
  [/\bhotel\b|restoran|restaurant|\bchef\b|barista|waiter|waitress|bartender|housekeeping|\bconcierge\b|catering|food\s*&?\s*bev|\bf&b\b|kitchen\s*(staff|supervisor|manager)|sommelier|kuliner/i,
    'Hospitality/F&B'],

  // ── Customer service / cabin crew ────────────────────────────────────────────
  [/customer\s*service|\bcs\b|call\s*center|technical\s*support|helpdesk|cabin\s*crew|flight\s*attendant|pramugari|pramugara|aviasi\b/i,
    'Customer Service'],

  // ── Leadership (last — "manager/lead/supervisor" appears in every senior title) ──
  [/manager|manajer|direktur|kepala\s|head\s*of|\blead\b|supervisor|\bvp\b|chief/i,
    'Manajemen/Leader'],
];

export const VALID_ARCHETYPES = [
  'Administrasi/GA', 'Marketing/Sales', 'Finance/Akuntansi', 'IT/Software',
  'HRD', 'Operasional/Logistik', 'Customer Service', 'Manajemen/Leader',
  'Fresh Graduate (trainee)',
  'Teknik/Manufaktur', 'Kreatif/Desain', 'Kesehatan', 'Pendidikan/Pelatihan', 'Hospitality/F&B',
  'Lainnya',
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
