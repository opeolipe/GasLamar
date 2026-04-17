// ── Module: download-docx-pdf.js ──────────────────────────────────────────────
// CV document generation: plain-text → DOCX (docx.js) and PDF (jsPDF).
// Depends on: cvDataCache (download-state.js), buildCVFilename + triggerDownload
// (download-file-utils.js), showMobileFallback (download-ui.js).
// Vendor libraries (docx, jspdf) are loaded via <script> tags in download.html.

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
    const trimmed = line.trim();
    if (!trimmed) return { type: 'blank', content: '' };

    const clean = trimmed.replace(/:$/, '').trim();
    const isSectionHead = CV_SECTION_HEADINGS.has(clean.toUpperCase())
                       || /^[A-Z\u00C0-\u017E\s]{4,}$/.test(clean)
                       || (trimmed.endsWith(':') && trimmed.length < 40);
    const isBullet = trimmed.startsWith('\u2022') || trimmed.startsWith('-')
                  || trimmed.startsWith('\u00B7') || trimmed.startsWith('*');

    if (isSectionHead) return { type: 'heading', content: clean };
    if (isBullet)      return { type: 'bullet',  content: trimmed.replace(/^[•\-·*]\s*/, '') };
    return { type: 'text', content: trimmed };
  });
}

// ── generateDOCX ──────────────────────────────────────────────────────────────
// Renders CV text into a .docx file and triggers a browser download.
// Uses the docx.js UMD build loaded via <script> in download.html.
function generateDOCX(cvText, lang, tier) {
  try {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = docx;

    const children = [];
    for (const { type, content } of parseLines(cvText)) {
      if (type === 'blank') {
        children.push(new Paragraph({ spacing: { after: 100 } }));
      } else if (type === 'heading') {
        children.push(new Paragraph({
          text: content,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 80 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
        }));
      } else if (type === 'bullet') {
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: 22, font: 'Calibri' })],
          bullet: { level: 0 },
          spacing: { after: 40 },
        }));
      } else {
        children.push(new Paragraph({
          children: [new TextRun({ text: content, size: 22, font: 'Calibri' })],
          spacing: { after: 60 },
        }));
      }
    }

    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, // 2.54 cm
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

    const pageWidth  = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX      = 20;
    const marginY      = 20;
    const contentWidth = pageWidth - marginX * 2;
    let y = marginY;

    doc.setFont('helvetica');

    for (const { type, content } of parseLines(cvText)) {
      if (type === 'blank') { y += 4; continue; }

      if (y > pageHeight - marginY) { doc.addPage(); y = marginY; }

      if (type === 'heading') {
        y += 4;
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(content.toUpperCase(), marginX, y);
        y += 1;
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.line(marginX, y, marginX + contentWidth, y);
        y += 5;
        doc.setDrawColor(0);

      } else if (type === 'bullet') {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.splitTextToSize('\u2022 ' + content, contentWidth - 5).forEach(function(l) {
          if (y > pageHeight - marginY) { doc.addPage(); y = marginY; }
          doc.text(l, marginX + 3, y);
          y += 5;
        });

      } else {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.splitTextToSize(content, contentWidth).forEach(function(l) {
          if (y > pageHeight - marginY) { doc.addPage(); y = marginY; }
          doc.text(l, marginX, y);
          y += 5;
        });
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
