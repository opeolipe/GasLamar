// ── Module: download-docx-pdf.js ──────────────────────────────────────────────
// CV document generation: plain-text → DOCX (docx.js) and PDF (jsPDF).
// Depends on: cvDataCache (download-state.js), buildCVFilename + triggerDownload
// (download-file-utils.js), showMobileFallback (download-ui.js).
// Vendor libraries (docx, jspdf) are loaded via <script> tags in download.html.

// ── EXPORT_STYLE ──────────────────────────────────────────────────────────────
// Shared typography/spacing tokens for DOCX and PDF exporters to keep parity.
const EXPORT_STYLE = {
  fontFamily: 'Times New Roman',
  bodyPt: 10.5,
  headingPt: 12,
  lineMm: 4.9,
  sectionGapMm: 4.4,
  paraGapMm: 2.2,
  bulletIndentMm: 4.8,
  bulletTextIndentMm: 8.6,
  pageMarginMm: 20,
  // DOCX uses twips / half-points.
  docx: {
    marginTwip: 1134,           // 20mm
    bodyHalfPt: 21,             // 10.5pt
    headingHalfPt: 24,          // 12pt
    spaceAfterBodyTwip: 120,    // 6pt
    spaceAfterHeadingTwip: 80,  // 4pt
    spaceBeforeHeadingTwip: 220,// 11pt
    blankAfterTwip: 70,         // 3.5pt
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
    const withoutMdHeading = line.replace(/^\s{0,3}#{1,6}\s+/, '');
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

// ── generateDOCX ──────────────────────────────────────────────────────────────
// Renders CV text into a .docx file and triggers a browser download.
// Uses the docx.js UMD build loaded via <script> in download.html.
function generateDOCX(cvText, lang, tier) {
  try {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = docx;
    const parsed = validateExportLines(parseLines(cvText));

    const children = [];
    for (let idx = 0; idx < parsed.length; idx++) {
      const { type, content } = parsed[idx];
      const prev = parsed[idx - 1] || null;
      if (type === 'blank') {
        if (prev && prev.type === 'blank') continue; // avoid double spacing explosions
        children.push(new Paragraph({ spacing: { after: EXPORT_STYLE.docx.blankAfterTwip } }));
      } else if (type === 'heading') {
        children.push(new Paragraph({
          text: content,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: EXPORT_STYLE.docx.spaceBeforeHeadingTwip, after: EXPORT_STYLE.docx.spaceAfterHeadingTwip },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
        }));
      } else if (type === 'role') {
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: EXPORT_STYLE.docx.bodyHalfPt, bold: true, font: EXPORT_STYLE.fontFamily })],
          spacing: { after: EXPORT_STYLE.docx.spaceAfterBodyTwip },
          keepLines: true,
          keepNext: true,
        }));
      } else if (type === 'meta' || type === 'contact') {
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: EXPORT_STYLE.docx.bodyHalfPt, font: EXPORT_STYLE.fontFamily, color: '555555' })],
          spacing: { after: EXPORT_STYLE.docx.spaceAfterBodyTwip },
          keepLines: true,
        }));
      } else if (type === 'bullet') {
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: EXPORT_STYLE.docx.bodyHalfPt, font: EXPORT_STYLE.fontFamily })],
          bullet: { level: 0 },
          spacing: { after: EXPORT_STYLE.docx.spaceAfterBodyTwip },
          keepLines: true,
        }));
      } else {
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: EXPORT_STYLE.docx.bodyHalfPt, font: EXPORT_STYLE.fontFamily })],
          spacing: { after: EXPORT_STYLE.docx.spaceAfterBodyTwip },
          keepLines: true,
        }));
      }
    }

    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: EXPORT_STYLE.docx.marginTwip, right: EXPORT_STYLE.docx.marginTwip, bottom: EXPORT_STYLE.docx.marginTwip, left: EXPORT_STYLE.docx.marginTwip } } },
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
    const parsed = validateExportLines(parseLines(cvText));

    const pageWidth  = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX      = EXPORT_STYLE.pageMarginMm;
    const marginY      = EXPORT_STYLE.pageMarginMm;
    const contentWidth = pageWidth - marginX * 2;
    let y = marginY;

    doc.setFont('times');
    let lastType = 'blank';

    function ensureSpace(heightNeeded) {
      if (y + heightNeeded > pageHeight - marginY) {
        doc.addPage();
        y = marginY;
        lastType = 'blank';
      }
    }

    function drawWrappedLine(text, x, width, size, style, lineHeight, color) {
      doc.setFontSize(size);
      doc.setFont('times', style);
      if (color) doc.setTextColor(color[0], color[1], color[2]);
      const lines = doc.splitTextToSize(text, width);
      for (const line of lines) {
        ensureSpace(lineHeight);
        doc.text(line, x, y);
        y += lineHeight;
      }
      doc.setTextColor(0, 0, 0);
    }

    for (const { type, content } of parsed) {
      if (type === 'blank') {
        if (lastType === 'blank') continue;
        y += EXPORT_STYLE.paraGapMm;
        lastType = 'blank';
        continue;
      }

      if (type === 'heading') {
        if (lastType !== 'blank') y += EXPORT_STYLE.sectionGapMm;
        ensureSpace(9);
        drawWrappedLine(content.toUpperCase(), marginX, contentWidth, EXPORT_STYLE.headingPt, 'bold', EXPORT_STYLE.lineMm, [0, 0, 0]);
        ensureSpace(1.8);
        doc.setDrawColor(180, 180, 180);
        doc.setLineWidth(0.25);
        doc.line(marginX, y - 1.5, marginX + contentWidth, y - 1.5);
        y += 1.6;
        lastType = 'heading';
        continue;
      }

      if (type === 'role') {
        drawWrappedLine(content, marginX, contentWidth, EXPORT_STYLE.bodyPt, 'bold', EXPORT_STYLE.lineMm, [20, 20, 20]);
        y += 0.6;
        lastType = 'role';
        continue;
      }

      if (type === 'meta' || type === 'contact') {
        drawWrappedLine(content, marginX, contentWidth, EXPORT_STYLE.bodyPt - 0.5, 'normal', EXPORT_STYLE.lineMm, [85, 85, 85]);
        lastType = type;
        continue;
      }

      if (type === 'bullet') {
        doc.setFontSize(EXPORT_STYLE.bodyPt);
        doc.setFont('times', 'normal');
        const lines = doc.splitTextToSize(content, contentWidth - EXPORT_STYLE.bulletTextIndentMm);
        for (let i = 0; i < lines.length; i++) {
          ensureSpace(EXPORT_STYLE.lineMm);
          if (i === 0) doc.text('\u2022', marginX + EXPORT_STYLE.bulletIndentMm, y);
          doc.text(lines[i], marginX + EXPORT_STYLE.bulletTextIndentMm, y);
          y += EXPORT_STYLE.lineMm;
        }
        lastType = 'bullet';
        continue;
      }

      drawWrappedLine(content, marginX, contentWidth, EXPORT_STYLE.bodyPt, 'normal', EXPORT_STYLE.lineMm, [20, 20, 20]);
      lastType = 'text';
    }

    const filename = buildCVFilename(cvText, cvDataCache ? cvDataCache.job_title : null, cvDataCache ? cvDataCache.company : null, lang, 'pdf');
    doc.save(filename);

  } catch (err) {
    console.error('PDF generation error:', err);
    showMobileFallback();
    alert('Tidak bisa generate PDF. Gunakan tombol salin teks di bawah.');
  }
}
