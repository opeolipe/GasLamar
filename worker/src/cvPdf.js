import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_W    = 595;
const PAGE_H    = 842;
const MARGIN    = 48;              // ≈17 mm — matches website download margins
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
  headingPt: 10.5,
  linePt: 14,
  paraGapPt: 7,
  bulletIndentPt: 11,
  bulletTextIndentPt: 23,
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
    .replace(/^\s{0,3}#{1,6}(?=\s*[A-Za-z\u00C0-\u017E])\s*/, '') // markdown headings
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

function parseExperienceLine(line) {
  // Pattern A: "Company — Role (Dates)" — date in parens on same line
  const withDate = line.match(/^(.*?)\s*[—–-]\s*(.*?)\s*\(([^)]+)\)\s*$/);
  if (withDate) {
    return { company: withDate[1].trim(), role: withDate[2].trim(), date: withDate[3].trim(), location: '' };
  }
  // Pattern B: "Company — Role" — date comes from next location-date line
  const dashOnly = line.match(/^(.*?)\s*[—–]\s*(.+)$/);
  if (dashOnly) {
    return { company: dashOnly[1].trim(), role: dashOnly[2].trim(), date: '', location: '' };
  }
  return { company: line, role: '', date: '', location: '' };
}

function parseHarvardLines(cvText, isIndonesian = false) {
  let nameFound    = false;
  let contactFound = false;

  return cvText.split('\n').map(line => {
    const trimmed = normalizeCvLine(line, isIndonesian);
    if (!trimmed) return { type: 'blank', content: '' };
    if (/^\s*\((catatan:|note:)/i.test(trimmed)) return { type: 'noise', content: '' };

    // Name and contact detected BEFORE heading/em-dash checks to avoid misclassification
    if (!nameFound) { nameFound = true; return { type: 'name', content: trimmed }; }
    if (!contactFound && (trimmed.includes('|') || trimmed.includes('@') || trimmed.startsWith('+'))) {
      contactFound = true;
      return { type: 'contact', content: trimmed };
    }

    const clean = trimmed.replace(/:$/, '').trim();
    const isSectionHead = CV_SECTION_HEADINGS.has(clean.toUpperCase())
                       || /^[A-ZÀ-ž\s]{4,}$/.test(clean)
                       || (trimmed.endsWith(':') && trimmed.length < 40);
    if (isSectionHead) return { type: 'heading', content: clean };

    if (/^[•\-·*]/.test(trimmed)) return { type: 'bullet', content: trimmed.replace(/^[•\-·*]\s*/, '') };

    if (/[—–]/.test(trimmed) && !/^\d/.test(trimmed)) return { type: 'company-role', content: trimmed };

    if (/^.+\s\|\s.+/.test(trimmed) && /\b(19|20)\d{2}\b/.test(trimmed)) return { type: 'location-date', content: trimmed };

    return { type: 'text', content: trimmed };
  });
}

function validateHarvardLines(parsed) {
  const out = [];
  const seenHeadings = new Set();

  for (const row of parsed) {
    if (row.type === 'noise') continue;
    if (row.type === 'heading') {
      const normalized = row.content.toUpperCase().trim();
      if (!normalized || seenHeadings.has(normalized)) continue;
      seenHeadings.add(normalized);
      out.push(row);
      continue;
    }
    if (row.type === 'bullet' && !row.content.trim()) continue;
    // Never filter name or contact rows
    if (row.type !== 'name' && row.type !== 'contact' && row.type !== 'blank') {
      if (/\[[^\]]{1,80}\]/.test(row.content) || /(?:\*\*|__|```)/.test(row.content)) continue;
    }
    out.push(row);
  }

  return out;
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
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic  = await doc.embedFont(StandardFonts.HelveticaOblique);
  const navy  = rgb(0.118, 0.227, 0.373); // #1E3A5F
  const dark  = rgb(0.10,  0.10,  0.10);
  const gray  = rgb(0.40,  0.40,  0.40);

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

  // ── Parse and render ──────────────────────────────────────────────────────────
  const isIndonesian = /(RINGKASAN PROFESIONAL|PENGALAMAN KERJA|PENDIDIKAN|KEAHLIAN)/i.test(cvText);
  const parsed = validateHarvardLines(parseHarvardLines(cvText, isIndonesian));

  for (let i = 0; i < parsed.length; i++) {
    const { type, content } = parsed[i];

    if (type === 'blank') {
      y -= EXPORT_STYLE.paraGapPt;
      continue;
    }

    if (type === 'noise') continue;

    if (type === 'name') {
      ensureSpace(30);
      const safe = sanitize(content);
      const w = bold.widthOfTextAtSize(safe, 24);
      page.drawText(safe, { x: (PAGE_W - w) / 2, y, font: bold, size: 24, color: dark });
      y -= 28;
      continue;
    }

    if (type === 'contact') {
      ensureSpace(18);
      const safe = sanitize(content);
      const w = regular.widthOfTextAtSize(safe, 9.5);
      page.drawText(safe, { x: (PAGE_W - w) / 2, y, font: regular, size: 9.5, color: gray });
      y -= 13;
      const lineW = 180;
      page.drawLine({ start: { x: (PAGE_W - lineW) / 2, y }, end: { x: (PAGE_W + lineW) / 2, y }, thickness: 0.5, color: navy });
      y -= 9;
      continue;
    }

    if (type === 'heading') {
      ensureSpace(49); // heading block + 2 body lines (orphan guard)
      y -= 4;
      // Accent bar in left margin: dimensions match jsPDF client (2.5mm × 5.5mm → ~7pt × 16pt)
      page.drawRectangle({ x: MARGIN - 11, y: y - 3.7, width: 7, height: 15.6, color: navy });
      drawWrapped(content.toUpperCase(), bold, EXPORT_STYLE.headingPt, navy, 0, EXPORT_STYLE.linePt);
      // Bottom rule spanning from accent bar to right margin
      page.drawLine({ start: { x: MARGIN - 11, y: y + 1 }, end: { x: PAGE_W - MARGIN, y: y + 1 }, thickness: 0.7, color: navy });
      y -= 3;
      continue;
    }

    if (type === 'company-role') {
      if (i > 0) y -= 2; // small visual gap before each role entry
      // Look ahead past blanks for a location-date companion
      let nextIdx = i + 1;
      while (nextIdx < parsed.length && parsed[nextIdx].type === 'blank') nextIdx++;
      const nextLine = nextIdx < parsed.length ? parsed[nextIdx] : null;

      const exp = parseExperienceLine(content);

      if (nextLine && nextLine.type === 'location-date') {
        const [location, dateRange] = nextLine.content.split(/\s\|\s/, 2);
        // Line 1: Company (bold-left) | Location (gray right-aligned)
        ensureSpace(EXPORT_STYLE.linePt * 2 + 4);
        const compSafe = sanitize(exp.company);
        const locSafe  = sanitize((location || '').trim());
        if (compSafe) page.drawText(compSafe, { x: MARGIN, y, font: bold, size: EXPORT_STYLE.bodyPt, color: dark });
        if (locSafe) {
          const locW = regular.widthOfTextAtSize(locSafe, 9.5);
          page.drawText(locSafe, { x: PAGE_W - MARGIN - locW, y, font: regular, size: 9.5, color: gray });
        }
        y -= EXPORT_STYLE.linePt;
        // Line 2: Role (italic-left) | Date range (gray right-aligned)
        ensureSpace(EXPORT_STYLE.linePt);
        const roleSafe = sanitize(exp.role || '');
        const dateSafe = sanitize((dateRange || '').trim());
        if (roleSafe) page.drawText(roleSafe, { x: MARGIN, y, font: italic, size: EXPORT_STYLE.bodyPt, color: dark });
        if (dateSafe) {
          const dateW = regular.widthOfTextAtSize(dateSafe, 9.5);
          page.drawText(dateSafe, { x: PAGE_W - MARGIN - dateW, y, font: regular, size: 9.5, color: gray });
        }
        y -= EXPORT_STYLE.linePt;
        i = nextIdx; // consume the companion location-date line

      } else if (exp.date) {
        // Date embedded in same line ("Company — Role (Date)")
        ensureSpace(EXPORT_STYLE.linePt * 2 + 4);
        const compSafe = sanitize(exp.company);
        const locSafe  = sanitize(exp.location || '');
        if (compSafe) page.drawText(compSafe, { x: MARGIN, y, font: bold, size: EXPORT_STYLE.bodyPt, color: dark });
        if (locSafe) {
          const locW = regular.widthOfTextAtSize(locSafe, 9.5);
          page.drawText(locSafe, { x: PAGE_W - MARGIN - locW, y, font: regular, size: 9.5, color: gray });
        }
        y -= EXPORT_STYLE.linePt;
        const roleSafe = sanitize(exp.role || '');
        const dateSafe = sanitize(exp.date);
        if (roleSafe) page.drawText(roleSafe, { x: MARGIN, y, font: italic, size: EXPORT_STYLE.bodyPt, color: dark });
        if (dateSafe) {
          const dateW = regular.widthOfTextAtSize(dateSafe, 9.5);
          page.drawText(dateSafe, { x: PAGE_W - MARGIN - dateW, y, font: regular, size: 9.5, color: gray });
        }
        y -= EXPORT_STYLE.linePt;

      } else {
        // Bare "Company — Role" with no date
        ensureSpace(EXPORT_STYLE.linePt);
        if (exp.company) {
          page.drawText(sanitize(exp.company), { x: MARGIN, y, font: bold, size: EXPORT_STYLE.bodyPt, color: dark });
          y -= EXPORT_STYLE.linePt;
        }
        if (exp.role) {
          ensureSpace(EXPORT_STYLE.linePt);
          page.drawText(sanitize(exp.role), { x: MARGIN, y, font: italic, size: EXPORT_STYLE.bodyPt, color: dark });
          y -= EXPORT_STYLE.linePt;
        }
      }
      continue;
    }

    if (type === 'location-date') {
      // Orphaned (not consumed by look-ahead): render as gray metadata text
      drawWrapped(content, regular, 10, gray, 0, EXPORT_STYLE.linePt);
      continue;
    }

    if (type === 'bullet') {
      const wrapped = wrapText(content, regular, EXPORT_STYLE.bodyPt, CONTENT_W - EXPORT_STYLE.bulletTextIndentPt);
      for (let bi = 0; bi < wrapped.length; bi++) {
        ensureSpace(EXPORT_STYLE.linePt);
        if (bi === 0) page.drawText('•', { x: MARGIN + EXPORT_STYLE.bulletIndentPt, y, font: regular, size: EXPORT_STYLE.bodyPt, color: dark });
        if (wrapped[bi]) page.drawText(wrapped[bi], { x: MARGIN + EXPORT_STYLE.bulletTextIndentPt, y, font: regular, size: EXPORT_STYLE.bodyPt, color: dark });
        y -= EXPORT_STYLE.linePt;
      }
      continue;
    }

    drawWrapped(content, regular, EXPORT_STYLE.bodyPt, dark, 0, EXPORT_STYLE.linePt);
  }

  // ── Page numbers (only when > 1 page) ────────────────────────────────────────
  const pages = doc.getPages();
  if (pages.length > 1) {
    pages.forEach((pg, idx) => {
      const label = sanitize(`${idx + 1} / ${pages.length}`);
      const w = regular.widthOfTextAtSize(label, 8);
      pg.drawText(label, { x: (PAGE_W - w) / 2, y: MARGIN / 2, font: regular, size: 8, color: gray });
    });
  }

  return doc.save();
}
