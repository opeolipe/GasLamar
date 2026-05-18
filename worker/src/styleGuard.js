import {
  ABSTRACTION_TERMS_ID,
  ABSTRACTION_TERMS_EN,
  SKILL_ALIAS_MAP_ID,
  SKILL_ALIAS_MAP_EN,
} from '../../shared/abstractionTerms.js';

const SUMMARY_START_RE = /^(?:RINGKASAN\s+(?:PROFESIONAL|EKSEKUTIF|SINGKAT)|PROFESSIONAL\s+SUMMARY|SUMMARY|PROFILE|PROFESSIONAL\s+PROFILE)\s*$/i;
const SUMMARY_END_RE = /^(?:PENGALAMAN\s+KERJA|WORK\s+EXPERIENCE|EMPLOYMENT\s+HISTORY|PENDIDIKAN|EDUCATION|KEAHLIAN|SKILLS|TECHNICAL\s+SKILLS|SERTIFIKASI|CERTIFICATIONS)\s*$/i;
const SKILLS_START_RE = /^(?:KEAHLIAN|SKILLS|TECHNICAL\s+SKILLS)\s*$/i;
const SECTION_HEADING_RE = /^(RINGKASAN PROFESIONAL|RINGKASAN|PENGALAMAN KERJA|PENDIDIKAN|KEAHLIAN|SERTIFIKASI|PROFESSIONAL SUMMARY|SUMMARY|WORK EXPERIENCE|EDUCATION|SKILLS|CERTIFICATIONS)\s*$/i;
const ROLE_HEADER_RE = /.+\s+[—–]\s+.+/;

function cleanLine(text) {
  return String(text || '').replace(/^[\s•\-*]\s*/, '').trim();
}

function tokenize(text) {
  return cleanLine(text).toLowerCase().split(/\W+/).filter(w => w.length >= 2);
}

function overlap(a, b) {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (!sa.size) return 0;
  let hit = 0;
  for (const t of sa) if (sb.has(t)) hit++;
  return hit / sa.size;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + c);
    }
  }
  return dp[m][n];
}

function collectRoleBullets(lines) {
  const roles = [];
  let inWork = false;
  let roleIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^(PENGALAMAN KERJA|WORK EXPERIENCE)\s*$/i.test(t)) {
      inWork = true;
      continue;
    }
    if (inWork && SECTION_HEADING_RE.test(t) && !/^(PENGALAMAN KERJA|WORK EXPERIENCE)\s*$/i.test(t)) break;
    if (!inWork) continue;
    if (!t) continue;
    if (!/^[\-•*]\s+/.test(t)) {
      if (ROLE_HEADER_RE.test(t)) {
        roleIdx++;
        if (!roles[roleIdx]) roles[roleIdx] = [];
      }
      continue;
    }
    if (roleIdx < 0) {
      roleIdx = 0;
      roles[roleIdx] = [];
    }
    roles[roleIdx].push({ lineIndex: i, text: cleanLine(t), localIndex: roles[roleIdx].length });
  }
  return roles;
}

function detectSeniorityEvidence(text) {
  const leadership = /\b(lead|manage|managed|supervise|supervised|team lead|manager|kepala|memimpin|supervisi|koordinator)\b/i.test(text);
  const strategy = /\b(strategy|strategic|roadmap|transformasi|perencanaan strategis|business transformation)\b/i.test(text);
  return { leadership, strategy };
}

function downgradeInflatedSeniority(text, sourceRoleText, language = 'id') {
  const ev = detectSeniorityEvidence(sourceRoleText);
  let out = text;
  if (language === 'en') {
    if (!ev.strategy) {
      out = out
        .replace(/\bstrategic\b/gi, 'operational')
        .replace(/\bbusiness transformation\b/gi, 'operational improvement')
        .replace(/\bmarket penetration\b/gi, 'sales area coverage');
    }
    if (!ev.leadership) {
      out = out
        .replace(/\bcross-functional leadership\b/gi, 'cross-team coordination')
        .replace(/\bled strategy\b/gi, 'supported execution');
    }
  } else {
    if (!ev.strategy) {
      out = out
        .replace(/\bstrategis\b/gi, 'operasional')
        .replace(/\btransformasi bisnis\b/gi, 'perbaikan operasional')
        .replace(/\bpenetrasi pasar\b/gi, 'cakupan area penjualan');
    }
    if (!ev.leadership) {
      out = out
        .replace(/\bkepemimpinan lintas fungsi\b/gi, 'koordinasi tim lintas fungsi')
        .replace(/\bmemimpin strategi\b/gi, 'mendukung pelaksanaan');
    }
  }
  return out;
}

function nearestSourceBullet(bullet, roleBullets) {
  const candidates = roleBullets && roleBullets.length > 0 ? roleBullets : [];
  let best = null;
  let bestScore = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestLev = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const score = overlap(bullet.text, c.text);
    const distance = Math.abs((bullet.localIndex ?? 0) - (c.localIndex ?? 0));
    const lev = levenshtein(bullet.text.toLowerCase(), c.text.toLowerCase());
    if (
      score > bestScore ||
      (score === bestScore && distance < bestDistance) ||
      (score === bestScore && distance === bestDistance && lev < bestLev)
    ) {
      best = c;
      bestScore = score;
      bestDistance = distance;
      bestLev = lev;
    }
  }
  return (best && bestScore >= 0.45) ? best : null;
}

function replaceAbstractions(text, language = 'id') {
  const map = language === 'en'
    ? [
        [/operational excellence/gi, 'day-to-day operations'],
        [/market penetration/gi, 'sales area coverage'],
        [/multitask coordination/gi, 'team coordination'],
        [/stakeholder/gi, 'client'],
      ]
    : [
        [/komunikasi profesional berkelanjutan/gi, 'komunikasi rutin dengan klien'],
        [/penetrasi pasar/gi, 'cakupan area penjualan'],
        [/koordinasi multitask/gi, 'koordinasi tim'],
        [/stakeholder/gi, 'klien'],
      ];
  let out = text;
  for (const [re, rep] of map) out = out.replace(re, rep);
  return out;
}

function ensureSummaryAnchor(text, originalCVText, language = 'id') {
  const summaryRe = /((?:RINGKASAN\s+(?:PROFESIONAL|EKSEKUTIF|SINGKAT)|PROFESSIONAL\s+SUMMARY|SUMMARY|PROFILE)\s*\n)([\s\S]*?)(?=\n(?:PENGALAMAN\s+KERJA|WORK\s+EXPERIENCE|EMPLOYMENT\s+HISTORY|PENDIDIKAN|EDUCATION|KEAHLIAN|SKILLS|TECHNICAL\s+SKILLS|SERTIFIKASI|CERTIFICATIONS)(?:\s|$))/i;
  const m = text.match(summaryRe);
  if (!m) return { text, changed: false, fallback: false };
  const heading = m[1];
  const body = m[2].trim();

  const sourceAnchors = new Set();
  const entityMatches = originalCVText.match(/\b([A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+){0,2})\b/g) || [];
  for (const e of entityMatches) if (e.length >= 4) sourceAnchors.add(e.toLowerCase());
  const roleTokens = originalCVText.match(/\b(sales|retail|fmcg|cabin|aviation|customer|service|operasional|distribusi|klien|penumpang|keselamatan)\b/gi) || [];
  for (const t of roleTokens) sourceAnchors.add(t.toLowerCase());

  const hasAnchor = Array.from(sourceAnchors).some(a => body.toLowerCase().includes(a));
  if (hasAnchor) return { text, changed: false, fallback: false };

  const fallback = language === 'en'
    ? 'Professional with relevant experience aligned to the target position.'
    : 'Profesional dengan pengalaman relevan yang selaras dengan posisi yang dituju.';
  const firstAnchor = Array.from(sourceAnchors)[0];
  const rebuilt = firstAnchor
    ? (language === 'en'
      ? `Experience in ${firstAnchor} with hands-on operational and client-facing work.`
      : `Berpengalaman di ${firstAnchor} dengan fokus kerja operasional dan komunikasi klien.`)
    : fallback;

  const replaced = text.replace(summaryRe, `${heading}${rebuilt}\n\n`);
  return { text: replaced, changed: true, fallback: !firstAnchor };
}

function applySkillsHumanization(text, originalCVText, language = 'id') {
  const aliasMap = language === 'en' ? SKILL_ALIAS_MAP_EN : SKILL_ALIAS_MAP_ID;
  const lines = text.split('\n');
  let inSkills = false;
  const lowerSource = originalCVText.toLowerCase();
  const modified = new Set();
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (SKILLS_START_RE.test(t)) {
      inSkills = true;
      continue;
    }
    if (inSkills && SECTION_HEADING_RE.test(t) && !SKILLS_START_RE.test(t)) inSkills = false;
    if (!inSkills || !t) continue;
    const clean = cleanLine(t).toLowerCase();
    const replacement = aliasMap[clean];
    if (!replacement) continue;
    const safe = lowerSource.includes(replacement.toLowerCase()) || lowerSource.includes(clean);
    if (!safe) continue;
    lines[i] = lines[i].replace(cleanLine(t), replacement);
    modified.add(i);
  }
  return { text: lines.join('\n'), modifiedLineIndexes: modified };
}

export function applyStyleGuard(text, originalCVText, opts = {}) {
  const { language = 'id' } = opts;
  const lines = text.split('\n');
  const sourceLines = originalCVText.split('\n');
  const modified = new Set();

  const terms = language === 'en' ? ABSTRACTION_TERMS_EN : ABSTRACTION_TERMS_ID;
  const sourceRoles = collectRoleBullets(sourceLines);
  const outRoles = collectRoleBullets(lines);
  const sectionAbsHits = terms.reduce((n, t) => n + ((text.toLowerCase().match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length), 0);

  const endingCounts = new Map();
  for (const role of outRoles) {
    const openCounts = new Map();
    const templateCounts = new Map();
    const roleAbsHits = role.reduce((n, b) => n + terms.filter(t => b.text.toLowerCase().includes(t)).length, 0);

    for (const bullet of role) {
      const words = tokenize(bullet.text);
      const endingStem = words.slice(-2).join(' ');
      const opening = words[0] || '';
      const template = words.slice(0, 3).join(' ');

      endingCounts.set(endingStem, (endingCounts.get(endingStem) || 0) + 1);
      openCounts.set(opening, (openCounts.get(opening) || 0) + 1);
      templateCounts.set(template, (templateCounts.get(template) || 0) + 1);

      const endingHit = endingCounts.get(endingStem) >= 3;
      const openingHit = openCounts.get(opening) >= 3;
      const templateHit = templateCounts.get(template) >= 3;
      const abstractHit = (roleAbsHits >= 2 || sectionAbsHits >= 3) && terms.some(t => bullet.text.toLowerCase().includes(t));

      if (!(endingHit || openingHit || templateHit || abstractHit)) continue;
      const nearest = nearestSourceBullet(bullet, sourceRoles[outRoles.indexOf(role)] || []);
      const originalText = nearest ? nearest.text : bullet.text;
      const sourceRoleText = (sourceRoles[outRoles.indexOf(role)] || []).map(r => r.text).join(' ');
      const compressed = downgradeInflatedSeniority(
        replaceAbstractions(originalText, language)
        .replace(/\b(through professional ongoing communication|secara profesional dan berkelanjutan)\b/gi, language === 'en' ? 'through routine client communication' : 'melalui komunikasi rutin dengan klien')
        .replace(/\s{2,}/g, ' ')
        .trim(),
        sourceRoleText,
        language,
      );
      lines[bullet.lineIndex] = lines[bullet.lineIndex].replace(cleanLine(lines[bullet.lineIndex]), compressed);
      modified.add(bullet.lineIndex);
    }
  }

  // Human phrasing preservation: avoid customer -> stakeholder escalation.
  if (/customer/i.test(originalCVText) && !/stakeholder/i.test(originalCVText)) {
    for (let i = 0; i < lines.length; i++) {
      const next = lines[i].replace(/\bstakeholder(s)?\b/gi, 'customer$1');
      if (next !== lines[i]) {
        lines[i] = next;
        modified.add(i);
      }
    }
  }

  let out = lines.join('\n');
  out = downgradeInflatedSeniority(replaceAbstractions(out, language), originalCVText, language);
  if (out !== text) {
    for (let i = 0; i < lines.length; i++) modified.add(i);
  }
  const summaryResult = ensureSummaryAnchor(out, originalCVText, language);
  out = summaryResult.text;
  if (summaryResult.changed) {
    out.split('\n').forEach((_, idx) => modified.add(idx));
  }

  const skillsResult = applySkillsHumanization(out, originalCVText, language);
  out = skillsResult.text;
  for (const idx of skillsResult.modifiedLineIndexes) modified.add(idx);

  if (summaryResult.fallback) {
    console.log(JSON.stringify({ event: 'summary_anchor_fallback', language }));
  }

  return {
    text: out,
    modifiedLineIndexes: Array.from(modified).sort((a, b) => a - b),
    summaryAnchorFallback: summaryResult.fallback,
  };
}
