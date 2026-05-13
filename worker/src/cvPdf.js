import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_W    = 595;
const PAGE_H    = 842;
const MARGIN    = 42;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const CV_SECTION_HEADINGS = new Set([
  'RINGKASAN PROFESIONAL', 'RINGKASAN', 'PENGALAMAN KERJA', 'PENGALAMAN',
  'PENDIDIKAN', 'KEAHLIAN', 'KEMAMPUAN', 'SERTIFIKASI', 'SERTIFIKAT',
  'PENCAPAIAN', 'PENGHARGAAN', 'PROYEK', 'PUBLIKASI', 'BAHASA', 'REFERENSI',
  'PROFESSIONAL SUMMARY', 'SUMMARY', 'EXECUTIVE SUMMARY',
  'WORK EXPERIENCE', 'EXPERIENCE', 'EMPLOYMENT HISTORY',
  'EDUCATION', 'SKILLS', 'TECHNICAL SKILLS', 'CORE COMPETENCIES',
  'CERTIFICATIONS', 'CERTIFICATES', 'ACHIEVEMENTS', 'AWARDS',
  'PROJECTS', 'PUBLICATIONS', 'LANGUAGES', 'REFERENCES', 'PROFILE',
]);

function sanitize(str) {
  return String(str || '')
    .replace(/[–—―]/g, '-')
    .replace(/[''ʼ]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[•‣●◦∙]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x00-\xFF]/g, '');
}

function normalizeCvLine(line, isIndonesian = false) {
  let text = String(line || '')
    .replace(/^\s{0,3}#{1,6}\s*/, '')     // markdown headings
    .replace(/\*\*(.*?)\*\*/g, '$1')      // bold markdown
    .replace(/__(.*?)__/g, '$1')          // underscore bold
    .replace(/\s+/g, ' ')
    .replace(/\s+(untuk menunjukkan dampak kerja yang konkret dan terukur)$/i, '')
    .replace(/\s+(to demonstrate concrete and measurable work impact)$/i, '')
    .trim();

  if (isIndonesian) {
    text = text
      .replace(/\bEast Java\b/gi, 'Jawa Timur')
      .replace(/\bWest Java\b/gi, 'Jawa Barat')
      .replace(/\bCentral Java\b/gi, 'Jawa Tengah')
      .replace(/\bNorth Sulawesi\b/gi, 'Sulawesi Utara')
      .replace(/\bSouth Sulawesi\b/gi, 'Sulawesi Selatan')
      .replace(/\bPresent\b/gi, 'Sekarang')
      .replace(/\bCurrent\b/gi, 'Sekarang');
  }

  return text;
}

function wrapText(text, font, size, maxWidth) {
  const out = [];
  for (const para of sanitize(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * Generates a clean Harvard-style CV PDF from plain-text CV content.
 * Uses pdf-lib (Worker-compatible — no browser APIs needed).
 * @param {string} cvText
 * @returns {Promise<Uint8Array>}
 */
export async function generateCVPdf(cvText) {
  const doc     = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold    = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic  = await doc.embedFont(StandardFonts.TimesRomanItalic);

  const black = rgb(0,    0,    0);
  const dark  = rgb(0.1,  0.1,  0.1);
  const gray  = rgb(0.45, 0.45, 0.45);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y    = PAGE_H - MARGIN;

  function ensureSpace(needed) {
    if (y < MARGIN + needed) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y    = PAGE_H - MARGIN;
    }
  }

  function drawWrapped(text, font, size, color, indent = 0) {
    const lines = wrapText(text, font, size, CONTENT_W - indent);
    for (const line of lines) {
      ensureSpace(size + 3);
      if (line) page.drawText(line, { x: MARGIN + indent, y, font, size, color });
      y -= size + 3;
    }
  }

  function textWidth(text, font, size) {
    return font.widthOfTextAtSize(sanitize(text), size);
  }

  // ── Parse and render ──────────────────────────────────────────────────────────
  const isIndonesian = /(RINGKASAN PROFESIONAL|PENGALAMAN KERJA|PENDIDIKAN|KEAHLIAN)/i.test(cvText);
  const rawLines  = cvText.split('\n');
  let nameFound   = false;
  let contactFound = false;

  for (let i = 0; i < rawLines.length; i++) {
    const line    = rawLines[i];
    const trimmed = normalizeCvLine(line, isIndonesian);

    if (!trimmed) { y -= 3; continue; }

    // Guidance lines (server notes) — skip silently
    if (/^\s{2}\((catatan:|note:)/i.test(line)) continue;

    // ── Name — always the first non-blank non-guidance line ──────────────────
    if (!nameFound) {
      nameFound = true;
      ensureSpace(22);
      const safe = sanitize(trimmed);
      const w    = textWidth(safe, bold, 16);
      page.drawText(safe, { x: (PAGE_W - w) / 2, y, font: bold, size: 16, color: black });
      y -= 22;
      continue;
    }

    // ── Contact — second meaningful line, centred ─────────────────────────────
    if (!contactFound && (trimmed.includes('|') || trimmed.includes('@') || trimmed.startsWith('+'))) {
      contactFound = true;
      ensureSpace(15);
      const safe = sanitize(trimmed);
      const w    = textWidth(safe, regular, 9);
      page.drawText(safe, { x: (PAGE_W - w) / 2, y, font: regular, size: 9, color: gray });
      y -= 15;
      // Thin rule under contact block
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.4, color: gray });
      y -= 8;
      continue;
    }

    // ── Section heading ────────────────────────────────────────────────────────
    const clean      = trimmed.replace(/:$/, '').trim();
    const isHeading  = CV_SECTION_HEADINGS.has(clean.toUpperCase())
                    || /^[A-ZÀ-ž\s]{4,}$/.test(clean)
                    || (trimmed.endsWith(':') && trimmed.length < 40);
    if (isHeading) {
      ensureSpace(22);
      y -= 5;
      page.drawLine({ start: { x: MARGIN, y: y + 1 }, end: { x: PAGE_W - MARGIN, y: y + 1 }, thickness: 0.4, color: gray });
      y -= 4;
      drawWrapped(clean.toUpperCase(), bold, 10, black);
      y -= 2;
      continue;
    }

    // ── Bullet ─────────────────────────────────────────────────────────────────
    if (/^[•\-·*]/.test(trimmed)) {
      const content = trimmed.replace(/^[•\-·*]\s*/, '');
      const wrapped = wrapText(content, regular, 9.5, CONTENT_W - 12);
      for (let li = 0; li < wrapped.length; li++) {
        ensureSpace(13);
        if (li === 0) page.drawText('•', { x: MARGIN + 4, y, font: regular, size: 9.5, color: dark });
        if (wrapped[li]) page.drawText(wrapped[li], { x: MARGIN + 12, y, font: regular, size: 9.5, color: dark });
        y -= 13;
      }
      continue;
    }

    // ── Company — Role (em/en-dash) ────────────────────────────────────────────
    if (/[—–]/.test(trimmed) && !/^\d/.test(trimmed)) {
      // Look ahead (skip blanks) for a location-date companion line
      let nextIdx = i + 1;
      while (nextIdx < rawLines.length && !normalizeCvLine(rawLines[nextIdx], isIndonesian)) nextIdx++;
      const nextTrimmed = nextIdx < rawLines.length ? normalizeCvLine(rawLines[nextIdx], isIndonesian) : '';
      const isLocDate   = /^.+\s\|\s.+/.test(nextTrimmed) && /\b(19|20)\d{2}\b/.test(nextTrimmed);

      const dashParts = trimmed.split(/\s*[—–]\s*/);
      const company   = sanitize(dashParts[0]?.trim() ?? '');
      const role      = sanitize(dashParts.slice(1).join(' - ').trim());

      if (i > 0) y -= 3;
      ensureSpace(26);

      if (isLocDate) {
        const [locRaw, dateRaw] = nextTrimmed.split(/\s\|\s/, 2);
        const loc  = sanitize(locRaw?.trim()  ?? '');
        const date = sanitize(dateRaw?.trim() ?? '');
        // Line 1: Company (bold left) + Location (right)
        page.drawText(company, { x: MARGIN, y, font: bold, size: 10, color: black });
        const locW = textWidth(loc, regular, 9.5);
        page.drawText(loc, { x: PAGE_W - MARGIN - locW, y, font: regular, size: 9.5, color: gray });
        y -= 13;
        ensureSpace(13);
        // Line 2: Role (italic left) + Date range (right)
        page.drawText(role, { x: MARGIN, y, font: italic, size: 9.5, color: dark });
        const dateW = textWidth(date, regular, 9.5);
        page.drawText(date, { x: PAGE_W - MARGIN - dateW, y, font: regular, size: 9.5, color: gray });
        y -= 14;
        i = nextIdx;
      } else {
        page.drawText(company, { x: MARGIN, y, font: bold, size: 10, color: black });
        y -= 13;
        if (role) {
          ensureSpace(13);
          page.drawText(role, { x: MARGIN, y, font: italic, size: 9.5, color: dark });
          y -= 14;
        }
      }
      continue;
    }

    // ── Location-date (orphaned — not consumed by look-ahead) ─────────────────
    if (/^.+\s\|\s.+/.test(trimmed) && /\b(19|20)\d{2}\b/.test(trimmed)) {
      drawWrapped(trimmed, regular, 9.5, gray);
      continue;
    }

    // ── Regular text ───────────────────────────────────────────────────────────
    drawWrapped(trimmed, regular, 9.5, dark);
  }

  return doc.save();
}
