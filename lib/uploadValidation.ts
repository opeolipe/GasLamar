export const WORKER_URL = (typeof window !== 'undefined' && window.location.hostname === 'staging.gaslamar.pages.dev')
  ? 'https://gaslamar-worker-staging.carolineratuolivia.workers.dev'
  : 'https://gaslamar-worker.carolineratuolivia.workers.dev';

export const MAX_FILE_SIZE = 5 * 1024 * 1024;
export const MAX_JD_CHARS = 5000;
export const MIN_JD_LENGTH = 100;
export const MIN_CV_TEXT_LENGTH = 100;

export const VALID_TIERS = ['coba', 'single', '3pack', 'jobhunt'] as const;
export type ValidTier = typeof VALID_TIERS[number];

export interface TierInfo {
  icon: string;
  name: string;
  desc: string;
}

export const TIER_DISPLAY: Record<ValidTier, TierInfo> = {
  coba:    { icon: '🧪', name: 'Coba Dulu',    desc: '1 CV · Rp 29.000'             },
  single:  { icon: '✨', name: 'Single',        desc: '1 CV Bilingual · Rp 59.000'   },
  '3pack': { icon: '📦', name: '3-Pack',        desc: '3 CV Bilingual · Rp 149.000'  },
  jobhunt: { icon: '🚀', name: 'Job Hunt Pack', desc: '10 CV Bilingual · Rp 299.000' },
};

export function validateFile(file: File): string | null {
  const ext = '.' + file.name.split('.').pop()!.toLowerCase();
  const validExts  = ['.pdf', '.docx', '.txt'];
  const validTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ];
  if (!validExts.includes(ext) && !validTypes.includes(file.type)) {
    if (ext === '.doc')   return 'Format .doc belum didukung. Buka di Word → Save As → .docx atau PDF, lalu upload lagi.';
    if (ext === '.pages') return 'Format .pages belum didukung. Export sebagai PDF dari Pages, lalu upload lagi.';
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext))
      return 'File gambar tidak didukung. Upload CV dalam format PDF, DOCX, atau TXT.';
    return 'Format tidak didukung. Upload CV dalam format PDF, DOCX, atau TXT (maks 5MB).';
  }
  if (file.size > MAX_FILE_SIZE)
    return `Ukuran file terlalu besar (${(file.size / 1024 / 1024).toFixed(1)}MB). Maksimal 5MB.`;
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

export function readFileAsEncodedBlob(file: File): Promise<string> {
  const ext = '.' + file.name.split('.').pop()!.toLowerCase();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    if (ext === '.txt') {
      reader.onload  = (e) => resolve(JSON.stringify({ type: 'txt', data: e.target!.result }));
      reader.onerror = () => reject(new Error('Gagal membaca file'));
      reader.readAsText(file, 'UTF-8');
    } else {
      reader.onload = (e) => {
        try {
          const buf = e.target!.result as ArrayBuffer;
          const b   = new Uint8Array(buf.slice(0, 4));
          if (ext === '.pdf'  && !(b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46))
            return reject(new Error('Bukan file PDF yang valid'));
          if (ext === '.docx' && !(b[0] === 0x50 && b[1] === 0x4b))
            return reject(new Error('Bukan file DOCX yang valid'));
          resolve(JSON.stringify({ type: ext.slice(1), data: arrayBufferToBase64(buf) }));
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Gagal membaca file'));
      reader.readAsArrayBuffer(file);
    }
  });
}

export function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

export function unescapeHtml(text: string): string {
  const map: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'" };
  return text.replace(/&amp;|&lt;|&gt;|&quot;|&#039;/g, m => map[m]);
}
