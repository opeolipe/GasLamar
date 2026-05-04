import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_W   = 595;
const PAGE_H   = 842;
const MARGIN   = 50;
const CONTENT_W = PAGE_W - 2 * MARGIN;

// Replace chars outside Latin-1 that pdf-lib standard fonts can't render
function sanitize(str) {
  return String(str || '')
    .replace(/[–—―]/g, '-')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[•‣●◦∙]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x00-\xFF]/g, '');
}

function wrapLines(text, font, size, maxWidth) {
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

export async function generateInterviewKitPdf(kit) {
  const doc     = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);

  const blue     = rgb(0.106, 0.31,  0.91);
  const darkBlue = rgb(0.04,  0.18,  0.55);
  const gray     = rgb(0.5,   0.5,   0.5);
  const dark     = rgb(0.13,  0.13,  0.13);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y    = PAGE_H - MARGIN;

  function ensureSpace(needed) {
    if (y < MARGIN + needed) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y    = PAGE_H - MARGIN;
    }
  }

  function drawTextBlock(text, font, size, color, indent = 0) {
    const lines = wrapLines(text, font, size, CONTENT_W - indent);
    for (const line of lines) {
      ensureSpace(size + 3);
      if (line !== '') {
        page.drawText(line, { x: MARGIN + indent, y, font, size, color });
      }
      y -= size + 3;
    }
  }

  function drawSectionHeader(title) {
    ensureSpace(24);
    y -= 8;
    page.drawLine({
      start: { x: MARGIN,          y: y + 2 },
      end:   { x: PAGE_W - MARGIN, y: y + 2 },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 4;
    drawTextBlock(title, bold, 10, blue);
    y -= 3;
  }

  // Title block
  drawTextBlock('INTERVIEW KIT', bold, 20, blue);
  y -= 2;
  drawTextBlock('Dibuat oleh GasLamar', regular, 9, gray);
  y -= 10;
  page.drawLine({
    start: { x: MARGIN,          y },
    end:   { x: PAGE_W - MARGIN, y },
    thickness: 1,
    color: blue,
  });
  y -= 14;

  if (kit.tell_me_about_yourself) {
    drawSectionHeader('PERKENALAN DIRI (Tell Me About Yourself)');
    drawTextBlock(kit.tell_me_about_yourself, regular, 9, dark);
  }

  if (kit.email_template) {
    drawSectionHeader('TEMPLATE EMAIL LAMARAN');
    drawTextBlock(`Subject: ${kit.email_template.subject}`, bold, 9, dark);
    y -= 3;
    drawTextBlock(kit.email_template.body, regular, 9, dark);
  }

  if (kit.whatsapp_message) {
    drawSectionHeader('PESAN WHATSAPP');
    drawTextBlock(kit.whatsapp_message, regular, 9, dark);
  }

  if (Array.isArray(kit.interview_questions) && kit.interview_questions.length > 0) {
    drawSectionHeader('PERTANYAAN INTERVIEW');
    kit.interview_questions.forEach((q, i) => {
      ensureSpace(40);
      const qText = q.question_id || q.question_en || '';
      drawTextBlock(`${i + 1}. ${qText}`, bold, 9, darkBlue);
      if (q.question_id && q.question_en) {
        drawTextBlock(q.question_en, regular, 8, gray, 12);
      }
      y -= 2;
      drawTextBlock('Contoh jawaban:', bold, 8, gray, 12);
      drawTextBlock(q.sample_answer, regular, 9, dark, 12);
      y -= 6;
    });
  }

  if (Array.isArray(kit.job_insights) && kit.job_insights.length > 0) {
    drawSectionHeader('KATA KUNCI JOB DESCRIPTION');
    kit.job_insights.forEach(ji => {
      drawTextBlock(`- ${ji.phrase}: ${ji.meaning}`, regular, 9, dark);
    });
  }

  return doc.save(); // Uint8Array
}
