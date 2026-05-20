import { describe, it, expect } from 'vitest';
import { applyStyleGuard } from '../src/styleGuard.js';

describe('styleGuard — repetition and nearest-source fallback', () => {
  it('suppresses repeated ending stem on 3rd occurrence and reuses factual source bullet', () => {
    const original = [
      'PENGALAMAN KERJA',
      'PT A — Sales',
      '- Menangani komunikasi klien area Surabaya',
      '- Menangani follow-up order retail area Gresik',
      '- Menangani koordinasi distribusi area Sidoarjo',
    ].join('\n');
    const generated = [
      'PENGALAMAN KERJA',
      'PT A — Sales',
      '- Menangani komunikasi klien untuk memastikan',
      '- Menangani follow-up order retail untuk memastikan',
      '- Menangani koordinasi distribusi untuk memastikan',
    ].join('\n');
    const { text } = applyStyleGuard(generated, original, { language: 'id' });
    expect(text).toContain('area Sidoarjo');
    expect((text.match(/untuk memastikan/gi) || []).length).toBeLessThan(3);
  });

  it('does not trigger repetitive opening guard at 2 occurrences', () => {
    const original = [
      'PENGALAMAN KERJA',
      'PT A — Sales',
      '- Menangani komunikasi klien area Surabaya',
      '- Menangani follow-up order retail area Gresik',
    ].join('\n');
    const { text } = applyStyleGuard(original, original, { language: 'id' });
    expect(text).toContain('Menangani komunikasi klien area Surabaya');
    expect(text).toContain('Menangani follow-up order retail area Gresik');
  });
});

describe('styleGuard — abstraction threshold + edge role block', () => {
  it('triggers abstraction limiter for 2-bullet role with >=2 abstraction terms', () => {
    const original = [
      'PENGALAMAN KERJA',
      'PT A — Sales',
      '- Menangani komunikasi klien area Surabaya',
      '- Menangani distribusi produk area Gresik',
    ].join('\n');
    const generated = [
      'PENGALAMAN KERJA',
      'PT A — Sales',
      '- Mengelola stakeholder dan koordinasi multitask area Surabaya',
      '- Menjaga komunikasi profesional berkelanjutan dengan stakeholder',
    ].join('\n');
    const { text } = applyStyleGuard(generated, original, { language: 'id' });
    expect(text.toLowerCase()).not.toContain('koordinasi multitask');
  });

  it('triggers section-level abstraction limiter at >=3 even when per-role <2', () => {
    const original = [
      'PENGALAMAN KERJA',
      'PT A — Sales',
      '- Menangani komunikasi klien area Surabaya',
      'PT B — Admin',
      '- Menyiapkan dokumen administrasi harian',
      'PT C — Retail',
      '- Menangani follow-up customer area Malang',
    ].join('\n');
    const generated = [
      'PENGALAMAN KERJA',
      'PT A — Sales',
      '- Menangani stakeholder area Surabaya',
      'PT B — Admin',
      '- Menyiapkan proses operasional harian',
      'PT C — Retail',
      '- Menjaga koordinasi multitask area Malang',
    ].join('\n');
    const { text } = applyStyleGuard(generated, original, { language: 'id' });
    expect(text.toLowerCase()).not.toContain('stakeholder');
  });
});

describe('styleGuard — summary anchor + skills humanization + seniority', () => {
  it('adds fallback summary when no concrete anchor exists', () => {
    const original = [
      'PENGALAMAN KERJA',
      'Siloam Hospital — Sales Executive',
      '- Menangani komunikasi klien area Surabaya',
    ].join('\n');
    const generated = [
      'RINGKASAN PROFESIONAL',
      'Profesional dinamis yang berorientasi hasil.',
      '',
      'PENGALAMAN KERJA',
      'Siloam Hospital — Sales Executive',
      '- Menangani komunikasi klien area Surabaya',
    ].join('\n');
    const { text } = applyStyleGuard(generated, original, { language: 'id' });
    expect(text).toContain('Berpengalaman');
  });

  it('humanizes synthetic skill label only when source contains matching safe term', () => {
    const original = [
      'KEAHLIAN',
      '- Komunikasi Klien',
    ].join('\n');
    const generated = [
      'KEAHLIAN',
      '- Komunikasi Bisnis Profesional',
    ].join('\n');
    const { text } = applyStyleGuard(generated, original, { language: 'id' });
    expect(text.toLowerCase()).toContain('komunikasi klien');
  });

  it('preserves customer phrasing and avoids escalation to stakeholder', () => {
    const original = [
      'WORK EXPERIENCE',
      'PT A — Sales',
      '- Managed customer communication for East Java retail accounts',
    ].join('\n');
    const generated = [
      'WORK EXPERIENCE',
      'PT A — Sales',
      '- Managed stakeholder communication for East Java retail accounts',
    ].join('\n');
    const { text } = applyStyleGuard(generated, original, { language: 'en' });
    expect(text.toLowerCase()).toContain('customer communication');
    expect(text.toLowerCase()).not.toContain('stakeholder communication');
  });

  it('keeps date/location lines stable without treating them as role headers', () => {
    const original = [
      'WORK EXPERIENCE',
      'PT A — Sales',
      'Surabaya | Jan 2022 - Dec 2023',
      '- Managed customer communication for East Java retail accounts',
      '- Prepared weekly distributor reports for area follow-up',
    ].join('\n');
    const generated = [
      'WORK EXPERIENCE',
      'PT A — Sales',
      'Surabaya | Jan 2022 - Dec 2023',
      '- Managed customer communication for East Java retail accounts',
      '- Managed customer communication for East Java retail accounts',
      '- Managed customer communication for East Java retail accounts',
    ].join('\n');
    const { text } = applyStyleGuard(generated, original, { language: 'en' });
    expect(text).toContain('Surabaya | Jan 2022 - Dec 2023');
    expect(text).toContain('PT A — Sales');
  });
});
