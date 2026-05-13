import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_W   = 595;
const PAGE_H   = 842;
const MARGIN   = 46;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const IK_STYLE = {
  titleSize: 18,
  subtitleSize: 9,
  headingSize: 10.5,
  bodySize: 9.5,
  metaSize: 8.5,
  lineGap: 3.8,
  sectionGap: 8,
  paragraphGap: 4,
  itemGap: 6,
  listIndent: 12,
};

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
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold    = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic  = await doc.embedFont(StandardFonts.TimesRomanItalic);

  const ink     = rgb(0.12, 0.12, 0.12);
  const softInk = rgb(0.33, 0.33, 0.33);
  const rule    = rgb(0.72, 0.72, 0.72);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y    = PAGE_H - MARGIN;

  function ensureSpace(needed) {
    if (y < MARGIN + needed) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y    = PAGE_H - MARGIN;
    }
  }

  function drawTextBlock(text, font, size, color, indent = 0, lineGap = IK_STYLE.lineGap) {
    const lines = wrapLines(text, font, size, CONTENT_W - indent);
    for (const line of lines) {
      ensureSpace(size + lineGap);
      if (line !== '') {
        page.drawText(line, { x: MARGIN + indent, y, font, size, color });
      }
      y -= size + lineGap;
    }
  }

  function drawSectionHeader(title) {
    ensureSpace(24 + IK_STYLE.sectionGap);
    if (y < PAGE_H - MARGIN - 20) y -= IK_STYLE.sectionGap;
    page.drawLine({
      start: { x: MARGIN, y: y + 2 },
      end:   { x: PAGE_W - MARGIN, y: y + 2 },
      thickness: 0.4,
      color: rule,
    });
    y -= 5;
    drawTextBlock(title, bold, IK_STYLE.headingSize, ink);
    y -= 1.5;
  }

  function drawBulletLine(text, indent = 0) {
    const bulletX = MARGIN + indent + 2;
    const textX = MARGIN + indent + IK_STYLE.listIndent;
    const wrapped = wrapLines(text, regular, IK_STYLE.bodySize, CONTENT_W - indent - IK_STYLE.listIndent);
    for (let i = 0; i < wrapped.length; i++) {
      ensureSpace(IK_STYLE.bodySize + IK_STYLE.lineGap);
      if (i === 0) {
        page.drawText('•', { x: bulletX, y, font: regular, size: IK_STYLE.bodySize, color: ink });
      }
      if (wrapped[i]) {
        page.drawText(wrapped[i], { x: textX, y, font: regular, size: IK_STYLE.bodySize, color: ink });
      }
      y -= IK_STYLE.bodySize + IK_STYLE.lineGap;
    }
  }

  function cleanValue(value) {
    return String(value || '')
      .replace(/\[[^\]]{1,80}\]/g, '')
      .replace(/(?:\*\*|__|```)/g, '')
      .trim();
  }

  // Title block
  drawTextBlock('INTERVIEW KIT', bold, IK_STYLE.titleSize, ink);
  y -= 2.5;
  drawTextBlock('Prepared for your application workflow', italic, IK_STYLE.subtitleSize, softInk);
  y -= 9;
  page.drawLine({
    start: { x: MARGIN, y },
    end:   { x: PAGE_W - MARGIN, y },
    thickness: 0.8,
    color: rule,
  });
  y -= 12;

  if (kit.tell_me_about_yourself) {
    drawSectionHeader('PERKENALAN DIRI / TELL ME ABOUT YOURSELF');
    drawTextBlock(cleanValue(kit.tell_me_about_yourself), regular, IK_STYLE.bodySize, ink);
  }

  if (kit.email_template) {
    drawSectionHeader('TEMPLATE EMAIL LAMARAN');
    drawTextBlock(`Subject: ${cleanValue(kit.email_template.subject)}`, bold, IK_STYLE.bodySize, ink);
    y -= IK_STYLE.paragraphGap;
    drawTextBlock(cleanValue(kit.email_template.body), regular, IK_STYLE.bodySize, ink);
  }

  if (kit.whatsapp_message) {
    drawSectionHeader('PESAN WHATSAPP');
    drawTextBlock(cleanValue(kit.whatsapp_message), regular, IK_STYLE.bodySize, ink);
  }

  if (Array.isArray(kit.interview_questions) && kit.interview_questions.length > 0) {
    drawSectionHeader('PERTANYAAN INTERVIEW');
    kit.interview_questions.forEach((q, i) => {
      ensureSpace(52);
      const qText = cleanValue(q.question_id || q.question_en || '');
      drawTextBlock(`${i + 1}. ${qText}`, bold, IK_STYLE.bodySize, ink);
      if (q.question_id && q.question_en) {
        drawTextBlock(cleanValue(q.question_en), italic, IK_STYLE.metaSize, softInk, IK_STYLE.listIndent);
      }
      y -= 1.5;
      drawTextBlock('Contoh jawaban:', bold, IK_STYLE.metaSize, softInk, IK_STYLE.listIndent);
      drawTextBlock(cleanValue(q.sample_answer), regular, IK_STYLE.bodySize, ink, IK_STYLE.listIndent);
      y -= IK_STYLE.itemGap;
    });
  }

  if (Array.isArray(kit.job_insights) && kit.job_insights.length > 0) {
    drawSectionHeader('KATA KUNCI JOB DESCRIPTION');
    kit.job_insights.forEach(ji => {
      const phrase = cleanValue(ji?.phrase);
      const meaning = cleanValue(ji?.meaning);
      if (!phrase && !meaning) return;
      drawBulletLine(`${phrase}${phrase && meaning ? ': ' : ''}${meaning}`);
      y -= 0.8;
    });
  }

  return doc.save(); // Uint8Array
}
