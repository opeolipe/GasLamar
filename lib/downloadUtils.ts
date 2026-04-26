import { Document, Packer, Paragraph, TextRun, HeadingLevel, BorderStyle } from 'docx';
import { jsPDF } from 'jspdf';
export { WORKER_URL } from '@/lib/uploadValidation';
import { DOCX_GUIDANCE } from '@/shared/rewriteRules.js';

// ── Tier helpers ──────────────────────────────────────────────────────────────

export const TIER_LABELS: Record<string, string> = {
  coba:    'Coba Dulu',
  single:  'Single',
  '3pack': '3-Pack',
  jobhunt: 'Job Hunt Pack',
};

export function isBilingual(tier: string): boolean {
  return tier !== 'coba';
}

export function isMultiCredit(tier: string): boolean {
  return tier === '3pack' || tier === 'jobhunt';
}

// ── Session storage helpers ───────────────────────────────────────────────────

export function clearClientSessionData(sessionId: string | null): void {
  sessionStorage.removeItem('gaslamar_tier');
  sessionStorage.removeItem('gaslamar_session');
  localStorage.removeItem('gaslamar_session');
  localStorage.removeItem('gaslamar_tier');
  if (sessionId) {
    sessionStorage.removeItem(`gaslamar_secret_${sessionId}`);
    localStorage.removeItem(`gaslamar_secret_${sessionId}`);
  }
}

export function getSessionSecret(sessionId: string): string | null {
  return sessionStorage.getItem(`gaslamar_secret_${sessionId}`)
    ?? localStorage.getItem(`gaslamar_secret_${sessionId}`);
}

export function buildSecretHeaders(secret: string | null): Record<string, string> {
  return secret ? { 'X-Session-Secret': secret } : {};
}

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

// ── CV text parsing ───────────────────────────────────────────────────────────

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

type ParsedLine = { type: 'heading' | 'bullet' | 'text' | 'blank'; content: string };

function parseLines(cvText: string): ParsedLine[] {
  return cvText.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return { type: 'blank', content: '' };
    const clean        = trimmed.replace(/:$/, '').trim();
    const isSectionHead = CV_SECTION_HEADINGS.has(clean.toUpperCase())
                       || /^[A-Z\u00C0-\u017E\s]{4,}$/.test(clean)
                       || (trimmed.endsWith(':') && trimmed.length < 40);
    const isBullet     = /^[•\-·*]/.test(trimmed);
    if (isSectionHead) return { type: 'heading', content: clean };
    if (isBullet)      return { type: 'bullet',  content: trimmed.replace(/^[•\-·*]\s*/, '') };
    return { type: 'text', content: trimmed };
  });
}

// ── DOCX generation ───────────────────────────────────────────────────────────

export async function generateDOCXBlob(cvText: string): Promise<Blob> {
  const children: Paragraph[] = [];
  // Track bullet index per section; guidance note appears after first 2 bullets only
  let sectionBulletCount = 0;

  for (const { type, content } of parseLines(cvText)) {
    if (type === 'blank') {
      children.push(new Paragraph({ spacing: { after: 100 } }));
    } else if (type === 'heading') {
      sectionBulletCount = 0; // reset on each new section
      children.push(new Paragraph({
        text:    content,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 80 },
        border:  { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
      }));
    } else if (type === 'bullet') {
      children.push(new Paragraph({
        children: [new TextRun({ text: content, size: 22, font: 'Calibri' })],
        bullet:   { level: 0 },
        spacing:  { after: 40 },
      }));
      // Append guidance hint after first 2 action bullets per section
      if (sectionBulletCount < 2) {
        children.push(new Paragraph({
          children: [new TextRun({ text: DOCX_GUIDANCE, size: 18, font: 'Calibri', color: '888888', italics: true })],
          spacing:  { after: 40 },
          indent:   { left: 360 },
        }));
        sectionBulletCount++;
      }
    } else {
      children.push(new Paragraph({
        children: [new TextRun({ text: content, size: 22, font: 'Calibri' })],
        spacing:  { after: 60 },
      }));
    }
  }

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children,
    }],
  });
  return Packer.toBlob(doc);
}

// ── PDF generation ────────────────────────────────────────────────────────────

export function generatePDFBlob(cvText: string): Blob {
  const doc        = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth  = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX    = 20;
  const marginY    = 20;
  const contentW   = pageWidth - marginX * 2;
  let y            = marginY;

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
      doc.line(marginX, y, marginX + contentW, y);
      y += 5;
      doc.setDrawColor(0);
    } else if (type === 'bullet') {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      (doc.splitTextToSize(`• ${content}`, contentW - 5) as string[]).forEach(l => {
        if (y > pageHeight - marginY) { doc.addPage(); y = marginY; }
        doc.text(l, marginX + 3, y);
        y += 5;
      });
    } else {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      (doc.splitTextToSize(content, contentW) as string[]).forEach(l => {
        if (y > pageHeight - marginY) { doc.addPage(); y = marginY; }
        doc.text(l, marginX, y);
        y += 5;
      });
    }
  }

  return doc.output('blob') as Blob;
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

export function formatExpiryDate(expiresAtMs: number): string {
  const d       = new Date(expiresAtMs);
  const dateStr = d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return `📅 Link berlaku hingga ${dateStr} pukul ${timeStr}`;
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
