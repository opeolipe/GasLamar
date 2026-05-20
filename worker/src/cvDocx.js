import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  BorderStyle,
  AlignmentType,
  TabStopType,
  LevelFormat,
} from 'docx';

// ── Constants ─────────────────────────────────────────────────────────────────

const CV_ACCENT_HEX = '1E3A5F';
const DOCX_BULLET_REF = 'harvard-cv-bullets';

// Matches server-side guidance annotations written by the LLM pipeline.
// These are editorial notes for the user, not content to include in exports.
const GUIDANCE_LINE_PATTERN = /^\s{2}\((catatan:|note:)/i;

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

// ── Line parser ───────────────────────────────────────────────────────────────

function parseExperienceLine(line) {
  const withDate = line.match(/^(.*?)\s*[—–-]\s*(.*?)\s*\(([^)]+)\)\s*$/);
  if (withDate) {
    return { company: withDate[1].trim(), role: withDate[2].trim(), date: withDate[3].trim(), location: '' };
  }
  const dashOnly = line.match(/^(.*?)\s*[—–]\s*(.+)$/);
  if (dashOnly) {
    return { company: dashOnly[1].trim(), role: dashOnly[2].trim(), date: '', location: '' };
  }
  return { company: line, role: '', date: '', location: '' };
}

function normalizeDocxLine(line, isIndonesian = false) {
  let text = String(line || '')
    .replace(/^\s{0,3}#{1,6}(?=\s*[A-Za-zÀ-ž])\s*/, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/\s+(untuk menunjukkan dampak kerja yang konkret dan terukur)$/i, '')
    .replace(/\s+(to demonstrate concrete and measurable work impact)$/i, '')
    .trim();

  if (isIndonesian) {
    text = text
      .replace(/\bEast Java\b/gi,       'Jawa Timur')
      .replace(/\bWest Java\b/gi,       'Jawa Barat')
      .replace(/\bCentral Java\b/gi,    'Jawa Tengah')
      .replace(/\bNorth Sulawesi\b/gi,  'Sulawesi Utara')
      .replace(/\bSouth Sulawesi\b/gi,  'Sulawesi Selatan')
      .replace(/\bPresent\b/gi,         'Sekarang')
      .replace(/\bCurrent\b/gi,         'Sekarang');
  }

  return text;
}

function parseHarvardLines(cvText) {
  let nameFound    = false;
  let contactFound = false;
  // Normalise line endings so Windows-formatted CV text (\r\n) doesn't corrupt
  // the first/last word of each line during split.
  const lines = cvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  // Detect language from section headings to apply locale transforms (e.g. Present→Sekarang)
  const isIndonesian = /(RINGKASAN PROFESIONAL|PENGALAMAN KERJA|PENDIDIKAN|KEAHLIAN)/i.test(cvText);

  return lines.map(raw => {
    // Guidance lines must be tested BEFORE normalisation (pattern uses leading spaces)
    if (GUIDANCE_LINE_PATTERN.test(raw)) return { type: 'guidance', content: raw.trim() };

    const trimmed = normalizeDocxLine(raw, isIndonesian);
    if (!trimmed) return { type: 'blank', content: '' };

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

// ── DOCX generator ────────────────────────────────────────────────────────────

/**
 * Generates a Harvard-style CV DOCX from plain-text CV content.
 * Typography and layout match the website's generateHarvardDOCX exactly.
 * Uses the `docx` npm package with Packer.toBase64String() — the only Packer
 * method that works in all environments (Node.js, browser, Cloudflare Workers).
 * @param {string} cvText
 * @returns {Promise<string>} base64-encoded DOCX — pass directly to Resend `content` field
 */
export async function generateCVDocx(cvText) {
  // A4 = 11906 twips wide. 17mm margins ≈ 964 twips each. Content = 9978 twips.
  const MARGIN_TWIPS  = 964;
  const CONTENT_TWIPS = 9978;

  const children = [];
  const lines = parseHarvardLines(cvText);

  for (let i = 0; i < lines.length; i++) {
    const { type, content } = lines[i];

    // Guidance lines are editorial notes — never included in exports
    if (type === 'guidance') continue;

    if (type === 'blank') {
      children.push(new Paragraph({ spacing: { after: 60 } }));
      continue;
    }

    if (type === 'name') {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [new TextRun({ text: content, size: 48, font: 'Calibri', bold: true, color: '141414' })],
      }));

    } else if (type === 'contact') {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 180 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: CV_ACCENT_HEX } },
        children: [new TextRun({ text: content, size: 19, font: 'Calibri', color: '4B4B4B' })],
      }));

    } else if (type === 'heading') {
      children.push(new Paragraph({
        spacing: { before: 220, after: 80 },
        indent: { left: 120 },
        border: {
          left:   { style: BorderStyle.SINGLE, size: 24, color: CV_ACCENT_HEX, space: 8 },
          bottom: { style: BorderStyle.SINGLE, size:  6, color: CV_ACCENT_HEX },
        },
        children: [new TextRun({
          text:  content.toUpperCase(),
          size:  22,
          font:  'Calibri',
          bold:  true,
          color: CV_ACCENT_HEX,
        })],
      }));

    } else if (type === 'company-role') {
      let nextIdx = i + 1;
      while (nextIdx < lines.length && lines[nextIdx].type === 'blank') nextIdx++;
      const nextLine = nextIdx < lines.length ? lines[nextIdx] : null;

      const parsed = parseExperienceLine(content);

      if (nextLine?.type === 'location-date') {
        const [location, dateRange] = nextLine.content.split(/\s\|\s/, 2);
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_TWIPS }],
          spacing: { after: 0 },
          children: [
            new TextRun({ text: parsed.company + '\t', font: 'Calibri', size: 21, bold: true, color: '141414' }),
            new TextRun({ text: location?.trim() ?? '', font: 'Calibri', size: 19, color: '555555' }),
          ],
        }));
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_TWIPS }],
          spacing: { after: 60 },
          children: [
            new TextRun({ text: (parsed.role || '') + '\t', font: 'Calibri', size: 20, italics: true, color: '3C3C3C' }),
            new TextRun({ text: dateRange?.trim() ?? '', font: 'Calibri', size: 19, color: '555555' }),
          ],
        }));
        i = nextIdx;

      } else if (parsed.date) {
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_TWIPS }],
          spacing: { after: 0 },
          children: [
            new TextRun({ text: parsed.company + '\t', font: 'Calibri', size: 21, bold: true, color: '141414' }),
            new TextRun({ text: parsed.location || '', font: 'Calibri', size: 19, color: '555555' }),
          ],
        }));
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_TWIPS }],
          spacing: { after: 60 },
          children: [
            new TextRun({ text: parsed.role + '\t', font: 'Calibri', size: 20, italics: true, color: '3C3C3C' }),
            new TextRun({ text: parsed.date, font: 'Calibri', size: 19, color: '555555' }),
          ],
        }));

      } else {
        children.push(new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: parsed.company, font: 'Calibri', size: 21, bold: true, color: '141414' })],
        }));
        if (parsed.role) {
          children.push(new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: parsed.role, font: 'Calibri', size: 20, italics: true, color: '3C3C3C' })],
          }));
        }
      }

    } else if (type === 'location-date') {
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: content, font: 'Calibri', size: 19, color: '555555' })],
      }));

    } else if (type === 'bullet') {
      children.push(new Paragraph({
        numbering: { reference: DOCX_BULLET_REF, level: 0 },
        spacing: { after: 40 },
        children: [new TextRun({ text: content, font: 'Calibri', size: 20, color: '1A1A1A' })],
      }));

    } else {
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: content, font: 'Calibri', size: 20, color: '1A1A1A' })],
      }));
    }
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: DOCX_BULLET_REF,
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: {
            paragraph: {
              indent: { left: 432, hanging: 216 },
            },
          },
        }],
      }],
    },
    sections: [{
      properties: {
        page: { margin: { top: MARGIN_TWIPS, right: MARGIN_TWIPS, bottom: MARGIN_TWIPS, left: MARGIN_TWIPS } },
      },
      children,
    }],
  });

  // toBase64String uses JSZip's "base64" type — no Buffer dependency, works everywhere.
  return Packer.toBase64String(doc);
}
