/**
 * Test data factory for GasLamar QA.
 *
 * Generates valid CV and JD content that satisfies server-side minimums:
 *   - CV text  : MIN_TXT_CV_CHARS = 1,500 chars (fileExtraction.js)
 *   - Job desc : 100 chars (fileExtraction.js)
 *   - JD UI max: 5,000 chars (Upload.tsx)
 *
 * Usage:
 *   import { validJD, longJD, minimalJD, cvText } from '../fixtures/test-data';
 */

// ── Job description fixtures ──────────────────────────────────────────────────

/** Minimal valid JD — just over the 100-char server-side floor. */
export const minimalJD =
  'Digital Marketing Specialist – PT Solusi Digital\n\nRequirements:\n- Social media management\n- Google Analytics';

/** Standard valid JD used across most tests (~400 chars, covers common assertions). */
export const validJD =
  'Product Manager – PT Teknologi Maju\n\n' +
  'Requirements:\n' +
  '- 3+ years product experience in B2C or B2B SaaS\n' +
  '- Strong stakeholder management and communication skills\n' +
  '- Familiarity with agile/scrum methodologies\n' +
  '- Data-driven decision making using SQL or BI tools\n\n' +
  'Responsibilities:\n' +
  '- Define and own the product roadmap for core features\n' +
  '- Work cross-functionally with engineering, design, and marketing\n' +
  '- Run discovery, define user stories, and prioritize the backlog\n' +
  '- Measure feature success with clear KPIs and iterate accordingly';

/**
 * Long JD for maxlength boundary tests.
 * Exactly 5,000 chars — the UI max — built from a realistic job posting template.
 */
export function longJD(length = 5000): string {
  const base =
    'Senior Software Engineer – PT Inovasi Teknologi\n\n' +
    'Kami mencari Senior Software Engineer yang berpengalaman untuk bergabung dengan tim kami.\n\n' +
    'Kualifikasi:\n' +
    '- Minimal 5 tahun pengalaman di bidang software engineering\n' +
    '- Menguasai TypeScript, React, dan Node.js\n' +
    '- Pengalaman dengan cloud infrastructure (AWS/GCP/Azure)\n' +
    '- Kemampuan komunikasi yang baik dalam tim lintas fungsi\n\n' +
    'Tanggung jawab:\n' +
    '- Merancang dan membangun fitur baru yang skalabel\n' +
    '- Melakukan code review dan mentoring junior engineers\n' +
    '- Berkolaborasi dengan product manager dan designer\n' +
    '- Memastikan kualitas kode melalui testing dan observability\n\n';

  if (base.length >= length) return base.slice(0, length);
  const padding = 'x'.repeat(length - base.length);
  return base + padding;
}

// ── CV text fixtures ──────────────────────────────────────────────────────────

/**
 * Minimal valid CV plain text — just over the 1,500-char server-side floor.
 * Used for text-only (non-PDF) CV tests.
 */
export function cvText(length = 1600): string {
  const base =
    'BUDI SANTOSO\nbudi.santoso@email.com | +62 812 3456 7890 | LinkedIn: linkedin.com/in/budisantoso\n\n' +
    'RINGKASAN\n' +
    'Software Engineer dengan 4 tahun pengalaman membangun aplikasi web dan mobile.\n' +
    'Berpengalaman dalam React, Node.js, dan PostgreSQL.\n\n' +
    'PENGALAMAN KERJA\n\n' +
    'Software Engineer – PT Digital Nusantara (2022–sekarang)\n' +
    '- Membangun fitur checkout baru yang meningkatkan konversi sebesar 15%\n' +
    '- Merancang ulang arsitektur API untuk mengurangi latensi dari 800ms ke 200ms\n' +
    '- Memimpin migrasi database dari MySQL ke PostgreSQL dengan zero downtime\n\n' +
    'Junior Developer – PT Startup Cepat (2020–2022)\n' +
    '- Mengembangkan dashboard analytics menggunakan React dan Chart.js\n' +
    '- Menulis unit tests yang meningkatkan code coverage dari 40% ke 80%\n' +
    '- Berkolaborasi dengan 3 tim produk untuk integrasi payment gateway\n\n' +
    'PENDIDIKAN\n' +
    'S1 Ilmu Komputer – Universitas Indonesia (2016–2020)\nIPK: 3.72/4.00\n\n' +
    'KEAHLIAN\n' +
    'TypeScript, React, Node.js, PostgreSQL, Redis, Docker, AWS, Git\n';

  if (base.length >= length) return base;
  const filler =
    '\nPROYEK TAMBAHAN\n' +
    '- Membangun open-source CLI tool untuk automasi deployment (500+ GitHub stars)\n' +
    '- Kontribusi pada beberapa library open-source di ekosistem React\n';
  let result = base + filler;
  while (result.length < length) result += filler;
  return result.slice(0, length);
}
