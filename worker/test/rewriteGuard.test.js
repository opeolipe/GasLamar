import { describe, it, expect } from 'vitest';
import { postProcessCV } from '../src/rewriteGuard.js';

describe('rewriteGuard — no number amplification', () => {
  it('does not allow fabricated percentage when source has no number', () => {
    const original = [
      'PENGALAMAN KERJA',
      '- Meningkatkan penjualan produk retail area Surabaya',
    ].join('\n');
    const generated = [
      'PENGALAMAN KERJA',
      '- Meningkatkan penjualan 20% produk retail area Surabaya',
    ].join('\n');
    const { text } = postProcessCV(generated, original, null, 'pdf', { language: 'id' });
    expect(text).not.toContain('20%');
    expect(text).toContain('Meningkatkan penjualan produk retail area Surabaya');
  });

  it('does not allow fabricated team size when source has no team number', () => {
    const original = [
      'WORK EXPERIENCE',
      '- Managed team coordination for retail account follow-up',
    ].join('\n');
    const generated = [
      'WORK EXPERIENCE',
      '- Managed a team of 5 for retail account follow-up',
    ].join('\n');
    const { text } = postProcessCV(generated, original, null, 'pdf', { language: 'en' });
    expect(text.toLowerCase()).not.toContain('team of 5');
    expect(text).toContain('Managed team coordination for retail account follow-up');
  });
});

