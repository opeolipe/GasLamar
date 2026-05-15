// ── Module: download-docx-pdf.js ──────────────────────────────────────────────
// CV document generation: plain-text → DOCX (docx.js) and PDF (jsPDF).
// Depends on: cvDataCache (download-state.js), buildCVFilename + triggerDownload
// (download-file-utils.js), showMobileFallback (download-ui.js).
// Vendor libraries (docx, jspdf) are loaded via <script> tags in download.html.

// ── EXPORT_STYLE ──────────────────────────────────────────────────────────────
// Shared typography/spacing tokens for DOCX and PDF exporters to keep parity.
const EXPORT_STYLE = {
  fontFamily: 'Calibri',
  bodyPt: 10.5,
  headingPt: 10.5,
  lineMm: 4.9,
  sectionGapMm: 4.4,
  paraGapMm: 2.2,
  bulletIndentMm: 4.0,
  bulletTextIndentMm: 8.0,
  pageMarginMm: 17,
  // Accent color: deep professional navy (#1E3A5F) — matches JadeAI Professional template.
  // Used for section headings, accent bars, and separator rules.
  accentRgb: [30, 58, 95],
  accentHex: '1E3A5F',
  // DOCX uses twips / half-points.
  docx: {
    marginTwip: 964,            // 17mm
    contentTwip: 9978,          // A4 (11906) - 2×964
    bodyHalfPt: 20,             // 10pt
    headingHalfPt: 22,          // 11pt
    nameHalfPt: 48,             // 24pt
    spaceAfterBodyTwip: 120,    // 6pt
    spaceAfterHeadingTwip: 80,  // 4pt
    spaceBeforeHeadingTwip: 220,// 11pt
    blankAfterTwip: 60,         // 3pt
  },
};

// ── CV_SECTION_HEADINGS ───────────────────────────────────────────────────────
// Single source of truth for section-heading detection in parseLines.
// Used by both generateDOCX and generatePDF so format changes stay in sync.
const CV_SECTION_HEADINGS = new Set([
  // Indonesian
  'RINGKASAN PROFESIONAL', 'RINGKASAN', 'PENGALAMAN KERJA', 'PENGALAMAN',
  'PENDIDIKAN', 'KEAHLIAN', 'KEMAMPUAN', 'SERTIFIKASI', 'SERTIFIKAT',
  'PENCAPAIAN', 'PENGHARGAAN', 'PROYEK', 'PUBLIKASI', 'BAHASA', 'REFERENSI',
  // English
  'PROFESSIONAL SUMMARY', 'SUMMARY', 'EXECUTIVE SUMMARY',
  'WORK EXPERIENCE', 'EXPERIENCE', 'EMPLOYMENT HISTORY',
  'EDUCATION', 'SKILLS', 'TECHNICAL SKILLS', 'CORE COMPETENCIES',
  'CERTIFICATIONS', 'CERTIFICATES', 'ACHIEVEMENTS', 'AWARDS',
  'PROJECTS', 'PUBLICATIONS', 'LANGUAGES', 'REFERENCES', 'PROFILE',
]);

// ── parseLines ────────────────────────────────────────────────────────────────
// Parses CV plain text into typed line objects consumed by generateDOCX/PDF.
// A line is classified as heading, bullet, text, or blank.
//
// @param  {string} cvText
// @returns {{ type: 'heading'|'bullet'|'text'|'blank', content: string }[]}
function parseLines(cvText) {
  return cvText.split('\n').map(function(line) {
    const withoutMdHeading = line.replace(/^\s{0,3}#{1,6}(?=\s*[A-Za-z\u00C0-\u017E])\s*/, '');
    const trimmed = withoutMdHeading.trim();
    if (!trimmed) return { type: 'blank', content: '' };

    if (/^\s*\((catatan:|note:)/i.test(trimmed)) return { type: 'noise', content: '' };

    const clean = trimmed.replace(/:$/, '').trim();
    const isSectionHead = CV_SECTION_HEADINGS.has(clean.toUpperCase())
                       || /^[A-Z\u00C0-\u017E\s]{4,}$/.test(clean)
                       || (trimmed.endsWith(':') && trimmed.length < 40);
    const isBullet = trimmed.startsWith('\u2022') || trimmed.startsWith('-')
                  || trimmed.startsWith('\u00B7') || trimmed.startsWith('*');
    const isRoleHeader = /[—–]/.test(trimmed) && !/^\d/.test(trimmed);
    const isMetaLine = /^.+\s\|\s.+/.test(trimmed) && /\b(19|20)\d{2}\b/.test(trimmed);
    const isContact = /@|(?:\+?\d[\d\s().-]{7,}\d)$/.test(trimmed);

    if (isSectionHead) return { type: 'heading', content: clean };
    if (isMetaLine) return { type: 'meta', content: trimmed };
    if (isContact) return { type: 'contact', content: trimmed };
    if (isRoleHeader) return { type: 'role', content: trimmed };
    if (isBullet)      return { type: 'bullet',  content: trimmed.replace(/^[•\-·*]\s*/, '') };
    return { type: 'text', content: trimmed };
  });
}

function localizeIndonesianText(text) {
  return String(text || '')
    .replace(/\bEast Java\b/gi, 'Jawa Timur')
    .replace(/\bWest Java\b/gi, 'Jawa Barat')
    .replace(/\bCentral Java\b/gi, 'Jawa Tengah')
    .replace(/\bNorth Sulawesi\b/gi, 'Sulawesi Utara')
    .replace(/\bSouth Sulawesi\b/gi, 'Sulawesi Selatan')
    .replace(/\bPresent\b/gi, 'Sekarang')
    .replace(/\bCurrent\b/gi, 'Sekarang');
}

function validateExportLines(parsed) {
  const out = [];
  let hasHeading = false;
  const seen = new Set();

  for (const row of parsed) {
    if (row.type === 'noise') continue;
    if (row.type === 'heading') {
      const normalized = row.content.toUpperCase().trim();
      if (!normalized) continue;
      if (seen.has(normalized)) continue; // remove duplicate headings
      seen.add(normalized);
      hasHeading = true;
      out.push(row);
      continue;
    }
    if (row.type === 'bullet' && !row.content.trim()) continue; // broken bullet
    if (/\[[^\]]{1,80}\]/.test(row.content) || /(?:\*\*|__|```)/.test(row.content)) {
      continue; // markdown / placeholder remnants
    }
    out.push(row);
  }

  return hasHeading ? out : parsed.filter(r => r.type !== 'noise');
}

// ── parseExperienceLine ───────────────────────────────────────────────────────
// Splits "Company — Role (Dates)" or "Company — Role" into structured parts.
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

// ── generateDOCX ──────────────────────────────────────────────────────────────
// Renders CV text into a .docx file and triggers a browser download.
// Uses the docx.js UMD build loaded via <script> in download.html.
function generateDOCX(cvText, lang, tier) {
  try {
    const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, TabStopType } = docx;
    let parsed = validateExportLines(parseLines(cvText));
    if (lang === 'id') {
      parsed = parsed.map(row => ({ ...row, content: localizeIndonesianText(row.content) }));
    }

    const S = EXPORT_STYLE.docx;
    const accentHex = EXPORT_STYLE.accentHex;

    const children = [];
    // Detect name: first non-blank non-heading line
    let nameEmitted = false;
    let contactEmitted = false;

    for (let idx = 0; idx < parsed.length; idx++) {
      const { type, content } = parsed[idx];
      const prev = parsed[idx - 1] || null;

      if (type === 'blank') {
        if (prev && prev.type === 'blank') continue;
        children.push(new Paragraph({ spacing: { after: S.blankAfterTwip } }));

      } else if (!nameEmitted && type !== 'heading' && type !== 'blank') {
        // First real line is always the candidate name
        nameEmitted = true;
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [new TextRun({ text: content, size: S.nameHalfPt, bold: true, font: EXPORT_STYLE.fontFamily, color: '141414' })],
        }));

      } else if (!contactEmitted && (type === 'contact' || type === 'meta')) {
        // Second block is contact info — add accent bottom border as separator
        contactEmitted = true;
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 180 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: accentHex } },
          children: [new TextRun({ text: content, size: 19, font: EXPORT_STYLE.fontFamily, color: '4B4B4B' })],
        }));

      } else if (type === 'heading') {
        // Left accent bar (thick left border) + navy bottom rule + navy text
        children.push(new Paragraph({
          spacing: { before: S.spaceBeforeHeadingTwip, after: S.spaceAfterHeadingTwip },
          indent: { left: 120 },
          border: {
            left:   { style: BorderStyle.SINGLE, size: 24, color: accentHex, space: 8 },
            bottom: { style: BorderStyle.SINGLE, size:  6, color: accentHex },
          },
          children: [new TextRun({
            text:  content.toUpperCase(),
            size:  S.headingHalfPt,
            bold:  true,
            font:  EXPORT_STYLE.fontFamily,
            color: accentHex,
          })],
        }));

      } else if (type === 'role') {
        // Look ahead past blanks for the companion meta (location-date) line
        let nextIdx = idx + 1;
        while (nextIdx < parsed.length && parsed[nextIdx].type === 'blank') nextIdx++;
        const companion = nextIdx < parsed.length && parsed[nextIdx].type === 'meta' ? parsed[nextIdx] : null;
        const exp = parseExperienceLine(content);
        const [location, dateRange] = companion ? companion.content.split(/\s\|\s/, 2) : ['', ''];

        // Line 1: Company (bold) TAB Location (gray, right-aligned via tab stop)
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: S.contentTwip }],
          spacing: { after: 0 },
          keepLines: true,
          keepNext: true,
          children: [
            new TextRun({ text: (exp.company || content) + '\t', size: S.bodyHalfPt + 1, bold: true, font: EXPORT_STYLE.fontFamily, color: '141414' }),
            new TextRun({ text: (location || exp.location || '').trim(), size: 19, font: EXPORT_STYLE.fontFamily, color: '555555' }),
          ],
        }));
        // Line 2: Role (italic) TAB Date range (gray, right-aligned)
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: S.contentTwip }],
          spacing: { after: S.spaceAfterBodyTwip },
          keepLines: true,
          children: [
            new TextRun({ text: (exp.role || '') + '\t', size: 19, font: EXPORT_STYLE.fontFamily, italics: true, color: '555555' }),
            new TextRun({ text: (dateRange || exp.date || '').trim(), size: 19, font: EXPORT_STYLE.fontFamily, color: '555555' }),
          ],
        }));
        if (companion) idx = nextIdx; // skip consumed meta line

      } else if (type === 'meta') {
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: 19, font: EXPORT_STYLE.fontFamily, color: '555555', italics: true })],
          spacing: { after: S.spaceAfterBodyTwip },
          keepLines: true,
        }));

      } else if (type === 'contact') {
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: 19, font: EXPORT_STYLE.fontFamily, color: '4B4B4B' })],
          spacing: { after: S.spaceAfterBodyTwip },
          keepLines: true,
        }));

      } else if (type === 'bullet') {
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: S.bodyHalfPt, font: EXPORT_STYLE.fontFamily, color: '1A1A1A' })],
          bullet: { level: 0 },
          spacing: { after: S.spaceAfterBodyTwip },
          keepLines: true,
        }));

      } else {
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: S.bodyHalfPt, font: EXPORT_STYLE.fontFamily, color: '1A1A1A' })],
          spacing: { after: S.spaceAfterBodyTwip },
          keepLines: true,
        }));
      }
    }

    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: S.marginTwip, right: S.marginTwip, bottom: S.marginTwip, left: S.marginTwip } } },
        children: children,
      }],
    });

    Packer.toBlob(doc).then(function(blob) {
      const filename = buildCVFilename(cvText, cvDataCache ? cvDataCache.job_title : null, cvDataCache ? cvDataCache.company : null, lang, 'docx');
      triggerDownload(blob, filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    });

  } catch (err) {
    console.error('DOCX generation error:', err);
    showMobileFallback();
    alert('Tidak bisa generate DOCX. Gunakan tombol salin teks di bawah.');
  }
}

// ── generatePDF ───────────────────────────────────────────────────────────────
// Renders CV text into a .pdf file and triggers a browser download.
// Uses the jsPDF UMD build loaded via <script> in download.html.
function generatePDF(cvText, lang, tier) {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    let parsed = validateExportLines(parseLines(cvText));
    if (lang === 'id') {
      parsed = parsed.map(row => ({ ...row, content: localizeIndonesianText(row.content) }));
    }

    const pageWidth    = doc.internal.pageSize.getWidth();
    const pageHeight   = doc.internal.pageSize.getHeight();
    const marginX      = EXPORT_STYLE.pageMarginMm;
    const marginY      = EXPORT_STYLE.pageMarginMm;
    const contentWidth = pageWidth - marginX * 2;
    const ac           = EXPORT_STYLE.accentRgb; // [30, 58, 95]
    let y              = marginY;

    doc.setFont('helvetica');
    doc.setTextColor(20, 20, 20);
    let lastType       = 'blank';
    let nameEmitted    = false;
    let contactEmitted = false;

    function resetColor() {
      doc.setTextColor(20, 20, 20);
      doc.setDrawColor(0, 0, 0);
      doc.setFillColor(0, 0, 0);
      doc.setLineWidth(0.5);
    }

    function ensureSpace(heightNeeded) {
      if (y + heightNeeded > pageHeight - marginY) {
        doc.addPage();
        y = marginY;
        lastType = 'blank';
      }
    }

    for (let i = 0; i < parsed.length; i++) {
      const { type, content } = parsed[i];
      if (type === 'blank') {
        if (lastType === 'blank') continue;
        y += EXPORT_STYLE.paraGapMm;
        lastType = 'blank';
        continue;
      }

      // First non-blank line is the candidate name \u2014 render large and centered
      if (!nameEmitted && type !== 'heading') {
        nameEmitted = true;
        ensureSpace(12);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(20, 20, 20);
        doc.setCharSpace(0.6);
        doc.text(content, pageWidth / 2, y, { align: 'center' });
        doc.setCharSpace(0);
        y += 10;
        lastType = 'name';
        continue;
      }

      // Second block: contact info with thin accent separator rule below
      if (!contactEmitted && (type === 'contact' || type === 'meta')) {
        contactEmitted = true;
        ensureSpace(10);
        doc.setFontSize(9.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        doc.text(content, pageWidth / 2, y, { align: 'center' });
        y += 5;
        doc.setDrawColor(ac[0], ac[1], ac[2]);
        doc.setLineWidth(0.5);
        doc.line(pageWidth / 2 - 32, y, pageWidth / 2 + 32, y);
        resetColor();
        y += 7;
        lastType = 'contact';
        continue;
      }

      if (type === 'heading') {
        if (lastType !== 'blank') y += EXPORT_STYLE.sectionGapMm;
        ensureSpace(12);
        // Left accent bar in left margin (2.5 mm wide, 5.5 mm tall)
        doc.setFillColor(ac[0], ac[1], ac[2]);
        doc.rect(marginX - 4, y - 4.2, 2.5, 5.5, 'F');
        // Heading text in accent color, uppercase bold
        doc.setFontSize(EXPORT_STYLE.headingPt);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(ac[0], ac[1], ac[2]);
        doc.text(content.toUpperCase(), marginX, y);
        y += 2;
        // Bottom rule spanning full content width incl. accent bar
        doc.setDrawColor(ac[0], ac[1], ac[2]);
        doc.setLineWidth(0.7);
        doc.line(marginX - 4, y, marginX + contentWidth, y);
        resetColor();
        y += 5;
        lastType = 'heading';
        continue;
      }

      if (type === 'role') {
        // Look ahead past blanks for the companion meta (location-date) line
        let nextIdx = i + 1;
        while (nextIdx < parsed.length && parsed[nextIdx].type === 'blank') nextIdx++;
        const companion = nextIdx < parsed.length && parsed[nextIdx].type === 'meta' ? parsed[nextIdx] : null;
        const exp = parseExperienceLine(content);
        const [location, dateRange] = companion ? companion.content.split(/\s\|\s/, 2) : ['', ''];

        ensureSpace(EXPORT_STYLE.lineMm * 2 + 1);
        // Line 1: Company (bold-left) | Location (gray right-aligned)
        doc.setFontSize(EXPORT_STYLE.bodyPt);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(20, 20, 20);
        doc.text(exp.company || content, marginX, y);
        const loc = (location || exp.location || '').trim();
        if (loc) {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(75, 75, 75);
          doc.text(loc, marginX + contentWidth, y, { align: 'right' });
        }
        y += EXPORT_STYLE.lineMm;
        // Line 2: Role (italic-left) | Date range (gray right-aligned)
        ensureSpace(EXPORT_STYLE.lineMm);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(60, 60, 60);
        doc.text(exp.role || '', marginX, y);
        const dr = (dateRange || exp.date || '').trim();
        if (dr) {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(75, 75, 75);
          doc.text(dr, marginX + contentWidth, y, { align: 'right' });
        }
        y += EXPORT_STYLE.lineMm + 0.5;
        if (companion) i = nextIdx; // skip consumed meta line
        resetColor();
        lastType = 'role';
        continue;
      }

      if (type === 'meta') {
        doc.setFontSize(EXPORT_STYLE.bodyPt - 0.5);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(75, 75, 75);
        const metaLines = doc.splitTextToSize(content, contentWidth);
        for (const line of metaLines) {
          ensureSpace(EXPORT_STYLE.lineMm);
          doc.text(line, marginX, y);
          y += EXPORT_STYLE.lineMm;
        }
        resetColor();
        lastType = 'meta';
        continue;
      }

      if (type === 'contact') {
        doc.setFontSize(EXPORT_STYLE.bodyPt - 0.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(75, 75, 75);
        const contactLines = doc.splitTextToSize(content, contentWidth);
        for (const line of contactLines) {
          ensureSpace(EXPORT_STYLE.lineMm);
          doc.text(line, marginX, y);
          y += EXPORT_STYLE.lineMm;
        }
        resetColor();
        lastType = 'contact';
        continue;
      }

      if (type === 'bullet') {
        doc.setFontSize(EXPORT_STYLE.bodyPt);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(20, 20, 20);
        const bulletX     = marginX + EXPORT_STYLE.bulletIndentMm;
        const contentX    = marginX + EXPORT_STYLE.bulletTextIndentMm;
        const bulletLines = doc.splitTextToSize(content, contentWidth - EXPORT_STYLE.bulletTextIndentMm);
        for (let i = 0; i < bulletLines.length; i++) {
          ensureSpace(EXPORT_STYLE.lineMm);
          if (i === 0) doc.text('\u2022', bulletX, y);
          doc.text(bulletLines[i], contentX, y);
          y += EXPORT_STYLE.lineMm;
        }
        lastType = 'bullet';
        continue;
      }

      doc.setFontSize(EXPORT_STYLE.bodyPt);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(20, 20, 20);
      const textLines = doc.splitTextToSize(content, contentWidth);
      for (const line of textLines) {
        ensureSpace(EXPORT_STYLE.lineMm);
        doc.text(line, marginX, y);
        y += EXPORT_STYLE.lineMm;
      }
      lastType = 'text';
    }

    // ── Page numbers (only when > 1 page) ──────────────────────────────────────
    const totalPages = doc.getNumberOfPages();
    if (totalPages > 1) {
      for (let pg = 1; pg <= totalPages; pg++) {
        doc.setPage(pg);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(150, 150, 150);
        doc.text(`${pg} / ${totalPages}`, pageWidth / 2, pageHeight - 7, { align: 'center' });
      }
    }

    const filename = buildCVFilename(cvText, cvDataCache ? cvDataCache.job_title : null, cvDataCache ? cvDataCache.company : null, lang, 'pdf');
    doc.save(filename);

  } catch (err) {
    console.error('PDF generation error:', err);
    showMobileFallback();
    alert('Tidak bisa generate PDF. Gunakan tombol salin teks di bawah.');
  }
}
