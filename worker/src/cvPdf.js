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

const EXPORT_STYLE = {
  bodyPt: 10.5,
  headingPt: 12,
  linePt: 14,
  paraGapPt: 7,
  bulletIndentPt: 14,
  bulletTextIndentPt: 26,
};

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

function parseLines(cvText, isIndonesian = false) {
  return cvText.split('\n').map((line) => {
    const trimmed = normalizeCvLine(line, isIndonesian);
    if (!trimmed) return { type: 'blank', content: '' };
    if (/^\s*\((catatan:|note:)/i.test(trimmed)) return { type: 'noise', content: '' };

    const clean = trimmed.replace(/:$/, '').trim();
    const isSectionHead = CV_SECTION_HEADINGS.has(clean.toUpperCase())
      || /^[A-Z\u00C0-\u017E\s]{4,}$/.test(clean)
      || (trimmed.endsWith(':') && trimmed.length < 40);
    const isBullet = /^[•\-·*]/.test(trimmed);
    const isRoleHeader = /[—–]/.test(trimmed) && !/^\d/.test(trimmed);
    const isMetaLine = /^.+\s\|\s.+/.test(trimmed) && /\b(19|20)\d{2}\b/.test(trimmed);
    const isContact = /@|(?:\+?\d[\d\s().-]{7,}\d)$/.test(trimmed);

    if (isSectionHead) return { type: 'heading', content: clean };
    if (isMetaLine) return { type: 'meta', content: trimmed };
    if (isContact) return { type: 'contact', content: trimmed };
    if (isRoleHeader) return { type: 'role', content: trimmed };
    if (isBullet) return { type: 'bullet', content: trimmed.replace(/^[•\-·*]\s*/, '') };
    return { type: 'text', content: trimmed };
  });
}

function validateExportLines(parsed) {
  const out = [];
  const seenHeadings = new Set();
  let hasHeading = false;

  for (const row of parsed) {
    if (row.type === 'noise') continue;
    if (row.type === 'heading') {
      const normalized = row.content.toUpperCase().trim();
      if (!normalized || seenHeadings.has(normalized)) continue;
      seenHeadings.add(normalized);
      hasHeading = true;
      out.push(row);
      continue;
    }
    if (row.type === 'bullet' && !row.content.trim()) continue;
    if (/\[[^\]]{1,80}\]/.test(row.content) || /(?:\*\*|__|```)/.test(row.content)) continue;
    out.push(row);
  }

  return hasHeading ? out : parsed.filter((r) => r.type !== 'noise');
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

  function drawWrapped(text, font, size, color, indent = 0, lineStep = EXPORT_STYLE.linePt) {
    const lines = wrapText(text, font, size, CONTENT_W - indent);
    for (const line of lines) {
      ensureSpace(lineStep);
      if (line) page.drawText(line, { x: MARGIN + indent, y, font, size, color });
      y -= lineStep;
    }
  }

  function textWidth(text, font, size) {
    return font.widthOfTextAtSize(sanitize(text), size);
  }

  // ── Parse and render ──────────────────────────────────────────────────────────
  const isIndonesian = /(RINGKASAN PROFESIONAL|PENGALAMAN KERJA|PENDIDIKAN|KEAHLIAN)/i.test(cvText);
  let nameFound   = false;
  let contactFound = false;

  const parsed = validateExportLines(parseLines(cvText, isIndonesian));

  // Draw from parsed rows to stay in parity with website export behavior.
  for (const { type, content } of parsed) {
    if (type === 'blank') {
      y -= EXPORT_STYLE.paraGapPt;
      continue;
    }

    if (!nameFound && type !== 'blank') {
      nameFound = true;
      ensureSpace(24);
      const safe = sanitize(content);
      const w = textWidth(safe, bold, 16);
      page.drawText(safe, { x: (PAGE_W - w) / 2, y, font: bold, size: 16, color: black });
      y -= 22;
      continue;
    }

    if (!contactFound && type === 'contact') {
      contactFound = true;
      ensureSpace(16);
      const safe = sanitize(content);
      const w = textWidth(safe, regular, 9);
      page.drawText(safe, { x: (PAGE_W - w) / 2, y, font: regular, size: 9, color: gray });
      y -= 14;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.4, color: gray });
      y -= 8;
      continue;
    }

    if (type === 'heading') {
      ensureSpace(22);
      y -= 4;
      page.drawLine({ start: { x: MARGIN, y: y + 1 }, end: { x: PAGE_W - MARGIN, y: y + 1 }, thickness: 0.4, color: gray });
      y -= 4;
      drawWrapped(content.toUpperCase(), bold, EXPORT_STYLE.headingPt, black, 0, EXPORT_STYLE.linePt);
      y -= 2;
      continue;
    }

    if (type === 'role') {
      drawWrapped(content, bold, EXPORT_STYLE.bodyPt, dark, 0, EXPORT_STYLE.linePt);
      y -= 1;
      continue;
    }

    if (type === 'meta' || type === 'contact') {
      drawWrapped(content, regular, 9.5, gray, 0, EXPORT_STYLE.linePt);
      continue;
    }

    if (type === 'bullet') {
      const wrapped = wrapText(content, regular, EXPORT_STYLE.bodyPt, CONTENT_W - EXPORT_STYLE.bulletTextIndentPt);
      for (let i = 0; i < wrapped.length; i++) {
        ensureSpace(EXPORT_STYLE.linePt);
        if (i === 0) page.drawText('•', { x: MARGIN + EXPORT_STYLE.bulletIndentPt, y, font: regular, size: EXPORT_STYLE.bodyPt, color: dark });
        if (wrapped[i]) page.drawText(wrapped[i], { x: MARGIN + EXPORT_STYLE.bulletTextIndentPt, y, font: regular, size: EXPORT_STYLE.bodyPt, color: dark });
        y -= EXPORT_STYLE.linePt;
      }
      continue;
    }

    drawWrapped(content, regular, EXPORT_STYLE.bodyPt, dark, 0, EXPORT_STYLE.linePt);
  }

  return doc.save();
}
