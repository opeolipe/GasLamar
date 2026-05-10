import { Document, Packer, Paragraph, TextRun, BorderStyle, AlignmentType, TabStopType, LevelFormat } from 'docx';
import { jsPDF } from 'jspdf';
import {
  WORKER_URL,
  TIER_LABELS,
  isBilingual,
  isMultiCredit,
  clearClientSessionData,
  getSessionSecret,
  buildSecretHeaders,
} from '@/lib/sessionUtils';
export {
  WORKER_URL,
  TIER_LABELS,
  isBilingual,
  isMultiCredit,
  clearClientSessionData,
  getSessionSecret,
  buildSecretHeaders,
};

// Server-side guidance lines are prefixed with two spaces and wrapped in parens.
const GUIDANCE_LINE_PATTERN = /^\s{2}\((catatan:|note:)/i;

// ── Filename construction ─────────────────────────────────────────────────────

function sanitizeFilenamePart(raw: string | null | undefined, maxLen: number): string | null {
  if (!raw) return null;
  const ACCENT_MAP: Record<string, string> = {
    é:'e', è:'e', ê:'e', ë:'e', à:'a', â:'a', ä:'a',
    î:'i', ï:'i', ô:'o', ö:'o', ù:'u', û:'u', ü:'u',
    ç:'c', ñ:'n', ã:'a', õ:'o',
  };
  let s = raw.replace(/[éèêëàâäîïôöùûüçñãõ]/gi, c => ACCENT_MAP[c.toLowerCase()] ?? '');
  s = s.replace(/[^a-zA-Z0-9\s-]/g, '').trim()
       .replace(/\s+/g, '-')
       .replace(/-+/g, '-')
       .slice(0, maxLen)
       .replace(/-+$/, '');
  return s || null;
}

export function buildCVFilename(
  cvText: string,
  jobTitle: string | null,
  company: string | null,
  lang: 'id' | 'en',
  ext: 'docx' | 'pdf',
): string {
  const nameLine = cvText
    .split('\n').map(l => l.trim())
    .find(l => l.length > 1 && l.length < 60 && !/^[A-Z\s]{4,}$/.test(l)) ?? null;
  const firstName  = nameLine ? sanitizeFilenamePart(nameLine.split(/\s+/)[0], 20) : null;
  const langLabel  = lang === 'id' ? 'Indonesia' : 'English';
  const parts      = [firstName, sanitizeFilenamePart(jobTitle, 20), sanitizeFilenamePart(company, 20), langLabel].filter(Boolean);
  if (parts.length === 1) return `CV-${langLabel}.${ext}`;
  return parts.join('_') + '.' + ext;
}

// ── Download trigger ──────────────────────────────────────────────────────────

export function triggerDownload(blob: Blob, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Harvard CV line parser ────────────────────────────────────────────────────

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

type HarvardLineType =
  | 'name' | 'contact' | 'heading'
  | 'company-role' | 'location-date'
  | 'bullet' | 'guidance' | 'text' | 'blank';

type HarvardLine = { type: HarvardLineType; content: string };

// Splits "Company — Role (Dates)" or "Company — Role" into parts.
function parseExperienceLine(line: string): { company: string; role: string; date: string; location: string } {
  // Pattern A: "Company — Role (Dates)" — date in parens on same line
  const withDate = line.match(/^(.*?)\s*[—–-]\s*(.*?)\s*\(([^)]+)\)\s*$/);
  if (withDate) {
    return { company: withDate[1].trim(), role: withDate[2].trim(), date: withDate[3].trim(), location: '' };
  }
  // Pattern B: "Company — Role" — date comes from the next location-date line
  const dashOnly = line.match(/^(.*?)\s*[—–]\s*(.+)$/);
  if (dashOnly) {
    return { company: dashOnly[1].trim(), role: dashOnly[2].trim(), date: '', location: '' };
  }
  return { company: line, role: '', date: '', location: '' };
}

function parseHarvardLines(cvText: string): HarvardLine[] {
  let nameFound    = false;
  let contactFound = false;

  return cvText.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return { type: 'blank', content: '' };

    if (GUIDANCE_LINE_PATTERN.test(line)) return { type: 'guidance', content: trimmed };

    const clean = trimmed.replace(/:$/, '').trim();

    const isSectionHead = CV_SECTION_HEADINGS.has(clean.toUpperCase())
                       || /^[A-ZÀ-ž\s]{4,}$/.test(clean)
                       || (trimmed.endsWith(':') && trimmed.length < 40);
    if (isSectionHead) return { type: 'heading', content: clean };

    if (/^[•\-·*]/.test(trimmed)) return { type: 'bullet', content: trimmed.replace(/^[•\-·*]\s*/, '') };

    // Lines with an em/en-dash are experience or education entries (Company — Role)
    if (/[—–]/.test(trimmed) && !/^\d/.test(trimmed)) return { type: 'company-role', content: trimmed };

    // Lines with a pipe and a 4-digit year are location+date rows (City | Jan 2022 – Mar 2024)
    if (/^.+\s\|\s.+/.test(trimmed) && /\d{4}/.test(trimmed)) return { type: 'location-date', content: trimmed };

    if (!nameFound)    { nameFound    = true; return { type: 'name',    content: trimmed }; }
    if (!contactFound && (trimmed.includes('|') || trimmed.includes('@'))) {
      contactFound = true;
      return { type: 'contact', content: trimmed };
    }

    return { type: 'text', content: trimmed };
  });
}

// ── Harvard PDF renderer ──────────────────────────────────────────────────────

function generateHarvardPDF(cvText: string): Blob {
  const doc        = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth  = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX    = 15;
  const marginY    = 15;
  const contentW   = pageWidth - marginX * 2;
  let y            = marginY;
  const lineH      = 5.5;

  const checkPage = () => {
    if (y > pageHeight - marginY) { doc.addPage(); y = marginY; }
  };

  doc.setFont('times');

  for (let i = 0, lines = parseHarvardLines(cvText); i < lines.length; i++) {
    const { type, content } = lines[i];

    if (type === 'blank')    { y += 4; continue; }
    if (type === 'guidance') { continue; }
    checkPage();

    if (type === 'name') {
      doc.setFontSize(18);
      doc.setFont('times', 'bold');
      doc.text(content, pageWidth / 2, y, { align: 'center' });
      y += 8;

    } else if (type === 'contact') {
      doc.setFontSize(10);
      doc.setFont('times', 'normal');
      doc.text(content, pageWidth / 2, y, { align: 'center' });
      y += 7;

    } else if (type === 'heading') {
      // Reserve space for: 5mm before-gap + ~7mm text+rule + 5mm after-gap + 2 body lines.
      // checkPage() alone isn't enough — it only prevents y overflowing the margin,
      // not the case where the heading fits but its first body lines don't.
      const HEADING_NEEDED = 5 + 7 + 5 + lineH * 2;
      if (y + HEADING_NEEDED > pageHeight - marginY) { doc.addPage(); y = marginY; }
      y += 5;
      doc.setFontSize(11);
      doc.setFont('times', 'bold');
      doc.text(content.toUpperCase(), marginX, y);
      y += 1.5;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      doc.line(marginX, y, marginX + contentW, y);
      doc.setDrawColor(0);
      y += 5;

    } else if (type === 'company-role') {
      // Small gap before each role entry so roles visually separate even without a blank line.
      if (i > 0) y += 2;
      // Look ahead past blank lines for a location-date companion
      let nextIdx = i + 1;
      while (nextIdx < lines.length && lines[nextIdx].type === 'blank') nextIdx++;
      const nextLine = nextIdx < lines.length ? lines[nextIdx] : null;

      const parsed = parseExperienceLine(content);

      if (nextLine?.type === 'location-date') {
        const [location, dateRange] = nextLine.content.split(/\s\|\s/, 2);
        // Line 1: Company (bold-left) | Location (right)
        doc.setFontSize(10);
        doc.setFont('times', 'bold');
        doc.text(parsed.company, marginX, y);
        doc.setFont('times', 'normal');
        doc.text(location?.trim() ?? '', marginX + contentW, y, { align: 'right' });
        y += lineH;
        checkPage();
        // Line 2: Role (italic-left) | Date range (right)
        doc.setFont('times', 'italic');
        doc.text(parsed.role || '', marginX, y);
        doc.setFont('times', 'normal');
        doc.text(dateRange?.trim() ?? '', marginX + contentW, y, { align: 'right' });
        y += lineH;
        i = nextIdx;

      } else if (parsed.date) {
        // Inline-date format: Company — Role (Date)
        doc.setFontSize(10);
        doc.setFont('times', 'bold');
        doc.text(parsed.company, marginX, y);
        doc.setFont('times', 'normal');
        if (parsed.location) doc.text(parsed.location, marginX + contentW, y, { align: 'right' });
        y += lineH;
        checkPage();
        doc.setFont('times', 'italic');
        doc.text(parsed.role, marginX, y);
        doc.setFont('times', 'normal');
        doc.text(parsed.date, marginX + contentW, y, { align: 'right' });
        y += lineH;

      } else {
        // Fallback: company bold then role italic on next line
        doc.setFontSize(10);
        doc.setFont('times', 'bold');
        doc.text(parsed.company, marginX, y);
        y += lineH;
        if (parsed.role) {
          checkPage();
          doc.setFont('times', 'italic');
          doc.text(parsed.role, marginX, y);
          y += lineH;
        }
      }
      doc.setFont('times', 'normal');

    } else if (type === 'location-date') {
      // Orphaned (not consumed by look-ahead): render as plain text
      doc.setFontSize(10);
      doc.setFont('times', 'normal');
      doc.text(content, marginX, y);
      y += lineH;

    } else if (type === 'bullet') {
      doc.setFontSize(10);
      doc.setFont('times', 'normal');
      // True hanging indent: '•' at bulletX, text content at contentX.
      // Continuation lines align to contentX, not to bulletX.
      const bulletX  = marginX + 5;
      const contentX = marginX + 9;
      (doc.splitTextToSize(content, contentW - 9) as string[]).forEach((l, idx) => {
        checkPage();
        if (idx === 0) doc.text('•', bulletX, y);
        doc.text(l, contentX, y);
        y += lineH;
      });

    } else {
      doc.setFontSize(10);
      doc.setFont('times', 'normal');
      (doc.splitTextToSize(content, contentW) as string[]).forEach(l => {
        checkPage();
        doc.text(l, marginX, y);
        y += lineH;
      });
    }
  }

  return doc.output('blob') as Blob;
}

// ── Harvard DOCX renderer ─────────────────────────────────────────────────────

const DOCX_BULLET_REF = 'harvard-cv-bullets';

async function generateHarvardDOCX(cvText: string): Promise<Blob> {
  // A4 = 11906 twips wide. Margins 720 twips ≈ 1.27 cm. Content width = 10466 twips.
  const MARGIN_TWIPS  = 720;
  const CONTENT_TWIPS = 10466;

  const children: Paragraph[] = [];

  for (let i = 0, lines = parseHarvardLines(cvText); i < lines.length; i++) {
    const { type, content } = lines[i];

    if (type === 'blank') {
      children.push(new Paragraph({ spacing: { after: 60 } }));
      continue;
    }

    if (type === 'name') {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [new TextRun({ text: content, size: 36, font: 'Times New Roman', bold: true })],
      }));

    } else if (type === 'contact') {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: content, size: 20, font: 'Times New Roman' })],
      }));

    } else if (type === 'heading') {
      children.push(new Paragraph({
        spacing: { before: 200, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '000000' } },
        children: [new TextRun({
          text: content.toUpperCase(),
          size: 22,
          font: 'Times New Roman',
          bold: true,
        })],
      }));

    } else if (type === 'company-role') {
      let nextIdx = i + 1;
      while (nextIdx < lines.length && lines[nextIdx].type === 'blank') nextIdx++;
      const nextLine = nextIdx < lines.length ? lines[nextIdx] : null;

      const parsed = parseExperienceLine(content);

      if (nextLine?.type === 'location-date') {
        const [location, dateRange] = nextLine.content.split(/\s\|\s/, 2);
        // Line 1: Company\tLocation — right tab aligns location to margin
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_TWIPS }],
          spacing: { after: 0 },
          children: [
            new TextRun({ text: parsed.company + '\t', font: 'Times New Roman', size: 20, bold: true }),
            new TextRun({ text: location?.trim() ?? '', font: 'Times New Roman', size: 20 }),
          ],
        }));
        // Line 2: Role\tDate range
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_TWIPS }],
          spacing: { after: 60 },
          children: [
            new TextRun({ text: (parsed.role || '') + '\t', font: 'Times New Roman', size: 20, italics: true }),
            new TextRun({ text: dateRange?.trim() ?? '', font: 'Times New Roman', size: 20 }),
          ],
        }));
        i = nextIdx;

      } else if (parsed.date) {
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_TWIPS }],
          spacing: { after: 0 },
          children: [
            new TextRun({ text: parsed.company + '\t', font: 'Times New Roman', size: 20, bold: true }),
            new TextRun({ text: parsed.location || '', font: 'Times New Roman', size: 20 }),
          ],
        }));
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_TWIPS }],
          spacing: { after: 60 },
          children: [
            new TextRun({ text: parsed.role + '\t', font: 'Times New Roman', size: 20, italics: true }),
            new TextRun({ text: parsed.date, font: 'Times New Roman', size: 20 }),
          ],
        }));

      } else {
        children.push(new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: parsed.company, font: 'Times New Roman', size: 20, bold: true })],
        }));
        if (parsed.role) {
          children.push(new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: parsed.role, font: 'Times New Roman', size: 20, italics: true })],
          }));
        }
      }

    } else if (type === 'location-date') {
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: content, font: 'Times New Roman', size: 20 })],
      }));

    } else if (type === 'bullet') {
      children.push(new Paragraph({
        numbering: { reference: DOCX_BULLET_REF, level: 0 },
        spacing: { after: 40 },
        children: [new TextRun({ text: content, font: 'Times New Roman', size: 20 })],
      }));

    } else if (type === 'guidance') {
      children.push(new Paragraph({
        spacing: { after: 40 },
        indent: { left: 360 },
        children: [new TextRun({ text: content, size: 18, font: 'Times New Roman', color: '888888', italics: true })],
      }));

    } else {
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: content, font: 'Times New Roman', size: 20 })],
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
  return Packer.toBlob(doc);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateDOCXBlob(cvText: string): Promise<Blob> {
  return generateHarvardDOCX(cvText);
}

export function generatePDFBlob(cvText: string): Blob {
  return generateHarvardPDF(cvText);
}

// ── Countdown helpers ─────────────────────────────────────────────────────────

export type CountdownVariant = 'normal' | 'warning' | 'expired';

export interface CountdownInfo {
  text:    string;
  variant: CountdownVariant;
}

export function getCountdownInfo(expiresAtMs: number, totalCredits: number): CountdownInfo {
  const msLeft      = expiresAtMs - Date.now();
  const isMulti     = totalCredits > 1;
  const label       = isMulti ? '30 hari' : '7 hari';
  const warnThresh  = isMulti ? 86_400_000 : 3_600_000;

  if (msLeft <= 0) {
    return { text: `⏰ Sesi kedaluwarsa — download tidak lagi tersedia (berlaku ${label}).`, variant: 'expired' };
  }

  const days  = Math.floor(msLeft / 86_400_000);
  const hours = Math.floor((msLeft % 86_400_000) / 3_600_000);
  const mins  = Math.floor((msLeft % 3_600_000) / 60_000);

  if (msLeft <= warnThresh) {
    const text = days > 0
      ? `⚠️ Link berakhir dalam ${days} hari — segera selesaikan download kamu!`
      : hours > 0
      ? `⚠️ Link berakhir dalam ${hours} jam ${mins} menit — segera selesaikan download kamu!`
      : `⚠️ Link berakhir dalam ${mins} menit — segera selesaikan download kamu!`;
    return { text, variant: 'warning' };
  }

  const text = days > 0
    ? `Link berlaku ${label} · Berakhir dalam ${days} hari ${hours} jam`
    : `Link berlaku ${label} · Berakhir dalam ${hours} jam ${mins} menit`;
  return { text, variant: 'normal' };
}

export function formatExpiryDate(expiresAtMs: number, totalCredits = 1): string {
  const d            = new Date(expiresAtMs);
  const dateStr      = d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr      = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const sessionLabel = totalCredits > 1 ? '30 hari' : '7 hari';
  return `📅 Sesi aktif hingga ${dateStr} pukul ${timeStr}\nLink email: berlaku 1 jam · Akses ulang: tersedia hingga ${sessionLabel}`;
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    const ta     = document.createElement('textarea');
    ta.value     = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}
