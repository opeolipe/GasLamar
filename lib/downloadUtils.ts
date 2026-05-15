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
  // Take the very first non-blank line — it is always the candidate's name.
  // The earlier all-caps exclusion wrongly skipped names like "BUDI SANTOSO".
  const nameLine = cvText
    .split('\n').map(l => l.trim().replace(/^#+\s*/, ''))
    .find(l => l.length > 1 && l.length < 60) ?? null;
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

    // ── Name and contact are detected BEFORE the heading/em-dash checks so that
    //    all-caps names like "BUDI SANTOSO" are not misclassified as section headings,
    //    and contact lines containing "|" + digits are not misclassified as location-date.
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

    // Lines with an em/en-dash are experience or education entries (Company — Role)
    if (/[—–]/.test(trimmed) && !/^\d/.test(trimmed)) return { type: 'company-role', content: trimmed };

    // Require a year-like pattern (19xx or 20xx) to avoid misclassifying phone numbers
    // or other pipe-delimited lines as location-date rows.
    if (/^.+\s\|\s.+/.test(trimmed) && /\b(19|20)\d{2}\b/.test(trimmed)) return { type: 'location-date', content: trimmed };

    return { type: 'text', content: trimmed };
  });
}

// ── CV accent color ───────────────────────────────────────────────────────────
// Deep professional navy — matches JadeAI Professional template (#1e3a5f).
// Used for section headings, accent bars, and separator rules in both PDF and DOCX.
const CV_ACCENT = { r: 30, g: 58, b: 95 } as const;
const CV_ACCENT_HEX = '1E3A5F' as const;

// ── Harvard PDF renderer ──────────────────────────────────────────────────────

function generateHarvardPDF(cvText: string): Blob {
  const doc        = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth  = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX    = 17;
  const marginY    = 17;
  const contentW   = pageWidth - marginX * 2;
  let y            = marginY;
  const lineH      = 5.5;

  const ac = CV_ACCENT;

  const checkPage = () => {
    if (y > pageHeight - marginY) { doc.addPage(); y = marginY; }
  };

  const resetColor = () => {
    doc.setTextColor(20, 20, 20);
    doc.setDrawColor(0, 0, 0);
    doc.setFillColor(0, 0, 0);
    doc.setLineWidth(0.5);
  };

  doc.setFont('helvetica');
  doc.setTextColor(20, 20, 20);

  for (let i = 0, lines = parseHarvardLines(cvText); i < lines.length; i++) {
    const { type, content } = lines[i];

    if (type === 'blank')    { y += 4; continue; }
    if (type === 'guidance') { continue; }
    checkPage();

    if (type === 'name') {
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(20, 20, 20);
      doc.setCharSpace(0.6);
      doc.text(content, pageWidth / 2, y, { align: 'center' });
      doc.setCharSpace(0);
      y += 10;

    } else if (type === 'contact') {
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.text(content, pageWidth / 2, y, { align: 'center' });
      y += 5;
      // Thin accent rule beneath contact block — separates header from body
      doc.setDrawColor(ac.r, ac.g, ac.b);
      doc.setLineWidth(0.5);
      doc.line(pageWidth / 2 - 32, y, pageWidth / 2 + 32, y);
      resetColor();
      y += 7;

    } else if (type === 'heading') {
      // Reserve space: gap + heading row + rule + after-gap + 2 body lines
      const HEADING_NEEDED = 5 + 6 + 2 + 5 + lineH * 2;
      if (y + HEADING_NEEDED > pageHeight - marginY) { doc.addPage(); y = marginY; }
      y += 5;
      // Left accent bar in left margin (2.5 mm wide, spanning text height)
      doc.setFillColor(ac.r, ac.g, ac.b);
      doc.rect(marginX - 4, y - 4.2, 2.5, 5.5, 'F');
      // Heading text in accent color
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(ac.r, ac.g, ac.b);
      doc.text(content.toUpperCase(), marginX, y);
      y += 2;
      // Bottom rule spanning full content width incl. the accent bar
      doc.setDrawColor(ac.r, ac.g, ac.b);
      doc.setLineWidth(0.7);
      doc.line(marginX - 4, y, marginX + contentW, y);
      resetColor();
      y += 5;

    } else if (type === 'company-role') {
      // Small gap before each role entry so roles visually separate without blank lines
      if (i > 0) y += 2;
      // Look ahead past blank lines for a location-date companion
      let nextIdx = i + 1;
      while (nextIdx < lines.length && lines[nextIdx].type === 'blank') nextIdx++;
      const nextLine = nextIdx < lines.length ? lines[nextIdx] : null;

      const parsed = parseExperienceLine(content);

      if (nextLine?.type === 'location-date') {
        const [location, dateRange] = nextLine.content.split(/\s\|\s/, 2);
        // Line 1: Company (bold-left) | Location (gray right)
        doc.setFontSize(10.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(20, 20, 20);
        doc.text(parsed.company, marginX, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(85, 85, 85);
        doc.text(location?.trim() ?? '', marginX + contentW, y, { align: 'right' });
        y += lineH;
        checkPage();
        // Line 2: Role (italic left) | Date range (gray right)
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(60, 60, 60);
        doc.text(parsed.role || '', marginX, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(85, 85, 85);
        doc.text(dateRange?.trim() ?? '', marginX + contentW, y, { align: 'right' });
        y += lineH;
        i = nextIdx;

      } else if (parsed.date) {
        doc.setFontSize(10.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(20, 20, 20);
        doc.text(parsed.company, marginX, y);
        doc.setFont('helvetica', 'normal');
        if (parsed.location) {
          doc.setTextColor(85, 85, 85);
          doc.text(parsed.location, marginX + contentW, y, { align: 'right' });
        }
        y += lineH;
        checkPage();
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(60, 60, 60);
        doc.text(parsed.role, marginX, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(85, 85, 85);
        doc.text(parsed.date, marginX + contentW, y, { align: 'right' });
        y += lineH;

      } else {
        doc.setFontSize(10.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(20, 20, 20);
        doc.text(parsed.company, marginX, y);
        y += lineH;
        if (parsed.role) {
          checkPage();
          doc.setFont('helvetica', 'italic');
          doc.setTextColor(60, 60, 60);
          doc.text(parsed.role, marginX, y);
          y += lineH;
        }
      }
      resetColor();
      doc.setFont('helvetica', 'normal');

    } else if (type === 'location-date') {
      // Orphaned (not consumed by look-ahead): render as gray metadata text
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(85, 85, 85);
      doc.text(content, marginX, y);
      resetColor();
      y += lineH;

    } else if (type === 'bullet') {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(20, 20, 20);
      // Hanging indent: bullet marker at bulletX, wrapped text lines at contentX
      const bulletX  = marginX + 4;
      const contentX = marginX + 8;
      (doc.splitTextToSize(content, contentW - 8) as string[]).forEach((l, idx) => {
        checkPage();
        if (idx === 0) doc.text('•', bulletX, y);
        doc.text(l, contentX, y);
        y += lineH;
      });

    } else {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(20, 20, 20);
      (doc.splitTextToSize(content, contentW) as string[]).forEach(l => {
        checkPage();
        doc.text(l, marginX, y);
        y += lineH;
      });
    }
  }

  // ── Page numbers (only when > 1 page) ────────────────────────────────────────
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

  return doc.output('blob') as Blob;
}

// ── Harvard DOCX renderer ─────────────────────────────────────────────────────

const DOCX_BULLET_REF = 'harvard-cv-bullets';

async function generateHarvardDOCX(cvText: string): Promise<Blob> {
  // A4 = 11906 twips wide. 17 mm margins ≈ 964 twips each. Content = 9978 twips.
  const MARGIN_TWIPS  = 964;
  const CONTENT_TWIPS = 9978;

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
        children: [new TextRun({ text: content, size: 48, font: 'Calibri', bold: true, color: '141414' })],
      }));

    } else if (type === 'contact') {
      // Accent bottom border acts as the separator between header and body sections
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 180 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: CV_ACCENT_HEX } },
        children: [new TextRun({ text: content, size: 19, font: 'Calibri', color: '4B4B4B' })],
      }));

    } else if (type === 'heading') {
      // Left accent bar (thick left border) + navy bottom rule + navy text — JadeAI Professional style
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
        // Line 1: Company (bold) | Location (gray, right-aligned)
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_TWIPS }],
          spacing: { after: 0 },
          children: [
            new TextRun({ text: parsed.company + '\t', font: 'Calibri', size: 21, bold: true, color: '141414' }),
            new TextRun({ text: location?.trim() ?? '', font: 'Calibri', size: 19, color: '555555' }),
          ],
        }));
        // Line 2: Role (italic) | Date range (gray, right-aligned)
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

    } else if (type === 'guidance') {
      children.push(new Paragraph({
        spacing: { after: 40 },
        indent: { left: 360 },
        children: [new TextRun({ text: content, size: 18, font: 'Calibri', color: '888888', italics: true })],
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
